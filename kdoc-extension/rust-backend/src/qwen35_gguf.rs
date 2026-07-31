use candle_core::quantized::{gguf_file, QTensor};
use candle_core::{DType, Device, Result, Tensor};
use candle_core::D;
use candle_nn::{
    kv_cache::ConcatKvCache, Activation, Embedding, Module, RmsNorm,
};
use candle_transformers::models::with_tracing::QMatMul;
use std::io::{Read, Seek};
use std::sync::Arc;

pub struct Gguf<R: Read + Seek> {
    ct: gguf_file::Content,
    reader: R,
    device: Device,
}

impl<R: Read + Seek> Gguf<R> {
    pub fn new(ct: gguf_file::Content, reader: R, device: Device) -> Self {
        Self {
            ct,
            reader,
            device,
        }
    }

    pub fn qmatmul(&mut self, name: &str) -> Result<QMatMul> {
        let ws = self.ct.tensor(&mut self.reader, name, &self.device)?;
        QMatMul::from_weights(ws.into())
    }

    pub fn rms_norm(&mut self, name: &str, eps: f64) -> Result<RmsNorm> {
        let ws = self.ct.tensor(&mut self.reader, name, &self.device)?;
        let ws = ws.dequantize(&self.device)?;
        Ok(RmsNorm::new(ws, eps))
    }

    pub fn tensor(&mut self, name: &str) -> Result<QTensor> {
        self.ct.tensor(&mut self.reader, name, &self.device)
    }

    pub fn tensor_dequant(&mut self, name: &str) -> Result<Tensor> {
        let qt = self.tensor(name)?;
        qt.dequantize(&self.device)
    }

    pub fn metadata(&self) -> &std::collections::HashMap<String, gguf_file::Value> {
        &self.ct.metadata
    }
}

#[derive(Debug, Clone)]
struct RotaryEmbedding {
    sin: Tensor,
    cos: Tensor,
}

impl RotaryEmbedding {
    fn new(dtype: DType, rope_dim: usize, max_pos: usize, rope_theta: f64, dev: &Device) -> Result<Self> {
        let inv_freq: Vec<_> = (0..rope_dim)
            .step_by(2)
            .map(|i| 1f32 / rope_theta.powf(i as f64 / rope_dim as f64) as f32)
            .collect();
        let inv_freq_len = inv_freq.len();
        let inv_freq = Tensor::from_vec(inv_freq, (1, inv_freq_len), dev)?.to_dtype(dtype)?;
        let t = Tensor::arange(0u32, max_pos as u32, dev)?
            .to_dtype(dtype)?
            .reshape((max_pos, 1))?;
        let freqs = t.matmul(&inv_freq)?;
        Ok(Self {
            sin: freqs.sin()?,
            cos: freqs.cos()?,
        })
    }

    fn apply(&self, q: &Tensor, k: &Tensor, offset: usize) -> Result<(Tensor, Tensor)> {
        let (_, _, seq_len, dim) = q.dims4()?;
        let rope_dim = self.cos.dim(1)?;
        let dtype = q.dtype();
        let cos = self.cos.narrow(0, offset, seq_len)?.to_dtype(dtype)?;
        let sin = self.sin.narrow(0, offset, seq_len)?.to_dtype(dtype)?;
        let q_pass = q.narrow(3, rope_dim * 2, dim - rope_dim * 2)?;
        let q_rot = q.narrow(3, 0, rope_dim * 2)?;
        let k_pass = k.narrow(3, rope_dim * 2, dim - rope_dim * 2)?;
        let k_rot = k.narrow(3, 0, rope_dim * 2)?;
        let q_rot = candle_nn::rotary_emb::rope(&q_rot.contiguous()?, &cos, &sin)?;
        let k_rot = candle_nn::rotary_emb::rope(&k_rot.contiguous()?, &cos, &sin)?;
        let q = Tensor::cat(&[&q_rot, &q_pass], 3)?;
        let k = Tensor::cat(&[&k_rot, &k_pass], 3)?;
        Ok((q, k))
    }
}

fn repeat_kv(x: Tensor, n_rep: usize) -> Result<Tensor> {
    if n_rep == 1 {
        return Ok(x);
    }
    let (b, n_kv, l, d) = x.dims4()?;
    let x = x.unsqueeze(2)?.expand((b, n_kv, n_rep, l, d))?;
    x.reshape((b, n_kv * n_rep, l, d))
}

#[derive(Debug, Clone)]
struct MlpWeights {
    gate_proj: QMatMul,
    up_proj: QMatMul,
    down_proj: QMatMul,
    act_fn: Activation,
}

impl MlpWeights {
    fn new<R: Read + Seek>(gg: &mut Gguf<R>, prefix: &str) -> Result<Self> {
        let gate_proj = gg.qmatmul(&format!("{prefix}.ffn_gate.weight"))?;
        let up_proj = gg.qmatmul(&format!("{prefix}.ffn_up.weight"))?;
        let down_proj = gg.qmatmul(&format!("{prefix}.ffn_down.weight"))?;
        Ok(Self {
            gate_proj,
            up_proj,
            down_proj,
            act_fn: Activation::Silu,
        })
    }
}

impl Module for MlpWeights {
    fn forward(&self, x: &Tensor) -> Result<Tensor> {
        let gate = self.gate_proj.forward(x)?.apply(&self.act_fn)?;
        let up = self.up_proj.forward(x)?;
        let gated = (gate * up)?;
        self.down_proj.forward(&gated)
    }
}

#[derive(Debug, Clone)]
struct FullAttention {
    q_proj: QMatMul,
    k_proj: QMatMul,
    v_proj: QMatMul,
    o_proj: QMatMul,
    q_norm: RmsNorm,
    k_norm: RmsNorm,
    num_heads: usize,
    num_kv_heads: usize,
    num_kv_groups: usize,
    head_dim: usize,
    q_head_dim: usize,
    rotary_emb: Arc<RotaryEmbedding>,
    kv_cache: ConcatKvCache,
}

impl FullAttention {
    fn new<R: Read + Seek>(
        gg: &mut Gguf<R>,
        num_heads: usize,
        num_kv_heads: usize,
        head_dim: usize,
        rms_norm_eps: f64,
        rotary_emb: Arc<RotaryEmbedding>,
        prefix: &str,
    ) -> Result<Self> {
        let q_proj = gg.qmatmul(&format!("{prefix}.attn_q.weight"))?;
        let k_proj = gg.qmatmul(&format!("{prefix}.attn_k.weight"))?;
        let v_proj = gg.qmatmul(&format!("{prefix}.attn_v.weight"))?;
        let o_proj = gg.qmatmul(&format!("{prefix}.attn_output.weight"))?;
        let q_norm = gg.rms_norm(&format!("{prefix}.attn_q_norm.weight"), rms_norm_eps)?;
        let k_norm = gg.rms_norm(&format!("{prefix}.attn_k_norm.weight"), rms_norm_eps)?;
        let q_w = gg.tensor_dequant(&format!("{prefix}.attn_q.weight"))?;
        let q_proj_out = q_w.dim(0)?;
        let k_w = gg.tensor_dequant(&format!("{prefix}.attn_k.weight"))?;
        let v_w = gg.tensor_dequant(&format!("{prefix}.attn_v.weight"))?;
        let q_norm_w = gg.tensor_dequant(&format!("{prefix}.attn_q_norm.weight"))?;
        let k_norm_w = gg.tensor_dequant(&format!("{prefix}.attn_k_norm.weight"))?;
        tracing::info!("Full attn {}: num_heads={}, num_kv_heads={}, head_dim={}", prefix, num_heads, num_kv_heads, head_dim);
        tracing::info!("  q_w: {:?}, k_w: {:?}, v_w: {:?}", q_w.shape(), k_w.shape(), v_w.shape());
        tracing::info!("  q_norm_w: {:?}, k_norm_w: {:?}", q_norm_w.shape(), k_norm_w.shape());

        Ok(Self {
            q_proj,
            k_proj,
            v_proj,
            o_proj,
            q_norm,
            k_norm,
            num_heads,
            num_kv_heads,
            num_kv_groups: num_heads / num_kv_heads,
            head_dim,
            q_head_dim: q_proj_out / num_heads,
            rotary_emb,
            kv_cache: ConcatKvCache::new(2),
        })
    }

    fn forward(&mut self, x: &Tensor, attn_mask: Option<&Tensor>, offset: usize) -> Result<Tensor> {
        let (b, l, _) = x.dims3()?;
        let q = self.q_proj.forward(x)?; // [b, l, num_heads * q_head_dim]
        let k = self.k_proj.forward(x)?; // [b, l, num_kv_heads * head_dim]
        let v = self.v_proj.forward(x)?; // [b, l, num_kv_heads * head_dim]

        // q has q_head_dim per head, split into q_query and q_gate
        let q = q.reshape((b, l, self.num_heads, self.q_head_dim))?.transpose(1, 2)?; // [b, h, l, q_head_dim]
        let q = q.contiguous()?;
        let q_query = q.narrow(3, 0, self.head_dim)?.contiguous()?; // [b, h, l, head_dim]
        let q_gate = q.narrow(3, self.head_dim, self.head_dim)?.contiguous()?; // [b, h, l, head_dim]

        let k = k
            .reshape((b, l, self.num_kv_heads, self.head_dim))?
            .transpose(1, 2)?;
        let v = v
            .reshape((b, l, self.num_kv_heads, self.head_dim))?
            .transpose(1, 2)?;

        let q_flat = q_query.flatten(0, 2)?.to_dtype(DType::F32)?;
        let k_flat = k.flatten(0, 2)?.to_dtype(DType::F32)?;
        let q_flat = self.q_norm.forward(&q_flat)?;
        let k_flat = self.k_norm.forward(&k_flat)?;

        let q_query = q_flat.reshape((b, self.num_heads, l, self.head_dim))?;
        let k = k_flat.reshape((b, self.num_kv_heads, l, self.head_dim))?;

        let (q_query, k) = self.rotary_emb.apply(&q_query, &k, offset)?;
        let q_query = q_query.contiguous()?;
        let k = k.contiguous()?;

        let v = v.to_dtype(DType::F32)?;
        let (k, v) = self.kv_cache.append(&k, &v)?;
        let k = repeat_kv(k, self.num_kv_groups)?.contiguous()?;
        let v = repeat_kv(v, self.num_kv_groups)?.contiguous()?;

        let scale = 1.0 / (self.head_dim as f64).sqrt();
        let k_t = k.transpose(2, 3)?.contiguous()?;
        let mut scores = (q_query.matmul(&k_t)? * scale)?;
        if let Some(m) = attn_mask {
            let m_dtype = m.dtype();
            let scores_dtype = scores.dtype();
            let mask = if m_dtype != scores_dtype {
                m.to_dtype(scores_dtype)?
            } else {
                m.clone()
            };
            scores = scores.broadcast_add(&mask)?;
        }

        // Softmax on CPU to avoid Metal kernel issues with large head_dim
        let dev = scores.device().clone();
        let scores_cpu = scores.to_device(&Device::Cpu)?.contiguous()?;
        let max_scores = scores_cpu.max_keepdim(D::Minus1)?;
        let exp_scores = scores_cpu.broadcast_sub(&max_scores)?.exp()?;
        let sum_exp = exp_scores.sum_keepdim(D::Minus1)?;
        let probs = exp_scores.broadcast_div(&sum_exp)?;
        let probs = probs.to_device(&dev)?;

        let ctx = probs.matmul(&v)?; // [b, h, l, head_dim]

        // Gate with q_gate (sigmoid, not silu)
        let q_gate = q_gate.to_dtype(DType::F32)?;
        let ctx = ctx.broadcast_mul(&candle_nn::ops::sigmoid(&q_gate)?)?;

        let reshaped = ctx.transpose(1, 2)?.reshape((b, l, self.num_heads * self.head_dim))?.contiguous()?;
        let reshaped = reshaped.to_dtype(x.dtype())?;
        self.o_proj.forward(&reshaped)
    }

    fn clear_kv_cache(&mut self) {
        self.kv_cache.reset();
    }
}

fn softplus(x: &Tensor) -> Result<Tensor> {
    // Numerically stable: softplus(x) = max(x, 0) + log(1 + exp(-|x|))
    let abs_x = x.abs()?;
    let exp_neg_abs = abs_x.neg()?.exp()?;
    let one = Tensor::new(1f32, x.device())?.to_dtype(x.dtype())?;
    let log1p = exp_neg_abs.broadcast_add(&one)?.log()?;
    let relu_x = x.clamp(0f32, f32::INFINITY)?;
    relu_x.broadcast_add(&log1p)
}

fn l2_norm(x: &Tensor, eps: f64) -> Result<Tensor> {
    let x_f32 = x.to_dtype(DType::F32)?;
    let norm = (x_f32.sqr()?.sum_keepdim(D::Minus1)? + eps)?.sqrt()?;
    x_f32.broadcast_div(&norm)?.to_dtype(x.dtype())
}

#[derive(Debug, Clone)]
struct SsmAttention {
    qkv_proj: QMatMul,
    qkv_gate_proj: QMatMul,
    beta_proj: QMatMul,
    alpha_proj: QMatMul,
    out_proj: QMatMul,
    conv1d_weight: Tensor,
    dt_bias: Tensor,
    a_log: Tensor,
    norm: RmsNorm,
    head_k_dim: usize,
    head_v_dim: usize,
    num_k_heads: usize,
    num_v_heads: usize,
    key_dim: usize,
    value_dim: usize,
    conv_dim: usize,
    conv_kernel: usize,
    inner_size: usize,
    time_step_rank: usize,
    n_group: usize,
    state_size: usize,
    rms_norm_eps: f64,
    ssm_state: Option<Tensor>,
    conv_state: Option<Tensor>,
}

impl SsmAttention {
    fn new<R: Read + Seek>(
        gg: &mut Gguf<R>,
        rms_norm_eps: f64,
        prefix: &str,
        ssm_state_size: usize,
        conv_kernel: usize,
        inner_size: usize,
        time_step_rank: usize,
        n_group: usize,
    ) -> Result<Self> {
        let head_k_dim = ssm_state_size;
        let num_k_heads = n_group;
        let num_v_heads = time_step_rank;
        let head_v_dim = inner_size / num_v_heads;
        let key_dim = head_k_dim * num_k_heads;
        let value_dim = head_v_dim * num_v_heads;
        let conv_dim = key_dim * 2 + value_dim;

        let qkv_proj = gg.qmatmul(&format!("{prefix}.attn_qkv.weight"))?;
        let qkv_gate_proj = gg.qmatmul(&format!("{prefix}.attn_gate.weight"))?;
        let beta_proj = gg.qmatmul(&format!("{prefix}.ssm_beta.weight"))?;
        let alpha_proj = gg.qmatmul(&format!("{prefix}.ssm_alpha.weight"))?;
        let out_proj = gg.qmatmul(&format!("{prefix}.ssm_out.weight"))?;
        let conv1d_weight = gg.tensor_dequant(&format!("{prefix}.ssm_conv1d.weight"))?;
        let dt_bias = gg.tensor_dequant(&format!("{prefix}.ssm_dt.bias"))?;
        let dt_bias = dt_bias.reshape((time_step_rank,))?;
        let a_log = gg.tensor_dequant(&format!("{prefix}.ssm_a"))?;
        let a_log = a_log.reshape((time_step_rank,))?;
        let norm = gg.rms_norm(&format!("{prefix}.ssm_norm.weight"), rms_norm_eps)?;
        tracing::info!(
            "GDN {}: head_k_dim={}, head_v_dim={}, num_k_heads={}, num_v_heads={}, key_dim={}, value_dim={}, conv_dim={}",
            prefix, head_k_dim, head_v_dim, num_k_heads, num_v_heads, key_dim, value_dim, conv_dim
        );
        tracing::info!(
            "  a_log={:?}, dt_bias={:?}, conv1d={:?}",
            a_log.shape(), dt_bias.shape(), conv1d_weight.shape()
        );

        Ok(Self {
            qkv_proj,
            qkv_gate_proj,
            beta_proj,
            alpha_proj,
            out_proj,
            conv1d_weight,
            dt_bias,
            a_log,
            norm,
            head_k_dim,
            head_v_dim,
            num_k_heads,
            num_v_heads,
            key_dim,
            value_dim,
            conv_dim,
            conv_kernel,
            inner_size,
            time_step_rank,
            n_group,
            state_size: ssm_state_size,
            rms_norm_eps,
            ssm_state: None,
            conv_state: None,
        })
    }

    fn apply_conv1d(&mut self, x: &Tensor, b: usize, t: usize) -> Result<Tensor> {
        let device = x.device();
        let dtype = x.dtype();
        let c = x.dim(2)?;
        let conv_w = self.conv1d_weight.reshape((c, self.conv_kernel))?;

        let x_t = x.transpose(1, 2)?; // [b, c, t]

        if t == 1 {
            let conv_state = match &self.conv_state {
                Some(s) => s.clone(),
                None => Tensor::zeros((b, c, self.conv_kernel - 1), dtype, device)?,
            };
            let combined = Tensor::cat(&[&conv_state, &x_t], 2)?; // [b, c, kernel]
            let window = &combined; // full window of size kernel
            let conv = window.broadcast_mul(&conv_w.unsqueeze(0)?)?.sum_keepdim(2)?;
            let conv = candle_nn::ops::silu(&conv)?;
            let new_state = combined.narrow(2, 1, self.conv_kernel - 1)?;
            self.conv_state = Some(new_state.contiguous()?);
            conv.transpose(1, 2)
        } else {
            let pad = Tensor::zeros((b, c, self.conv_kernel - 1), dtype, device)?;
            let x_padded = Tensor::cat(&[&pad, &x_t], 2)?; // [b, c, t + kernel - 1]
            let output = Tensor::zeros((b, c, t), dtype, device)?;
            for i in 0..t {
                let window = x_padded.narrow(2, i, self.conv_kernel)?;
                let conv = window.broadcast_mul(&conv_w.unsqueeze(0)?)?.sum_keepdim(2)?;
                output.slice_set(&conv, 2, i)?;
            }
            let new_state = x_padded.narrow(2, t, self.conv_kernel - 1)?;
            self.conv_state = Some(new_state.contiguous()?);
            let output = candle_nn::ops::silu(&output)?;
            output.transpose(1, 2)
        }
    }

    fn forward(&mut self, x: &Tensor, _offset: usize) -> Result<Tensor> {
        let (b, t, _h) = x.dims3()?;
        let device = x.device();

        let qkv = self.qkv_proj.forward(x)?; // [b, t, key_dim*2 + value_dim]
        let z = self.qkv_gate_proj.forward(x)?; // [b, t, value_dim]
        let beta = self.beta_proj.forward(x)?; // [b, t, num_v_heads]
        let alpha = self.alpha_proj.forward(x)?; // [b, t, num_v_heads]

        let qkv_conv = self.apply_conv1d(&qkv, b, t)?; // [b, t, conv_dim] with SiLU applied

        let q_conv = qkv_conv.narrow(2, 0, self.key_dim)?; // [b, t, key_dim]
        let k_conv = qkv_conv.narrow(2, self.key_dim, self.key_dim)?; // [b, t, key_dim]
        let v_conv = qkv_conv.narrow(2, self.key_dim * 2, self.value_dim)?; // [b, t, value_dim]

        let dt_bias = self.dt_bias.to_dtype(DType::F32)?;

        let ssm_a = self.a_log.to_dtype(DType::F32)?; // GGUF already stores -exp(A_log)

        let mut ssm_state = match &self.ssm_state {
            Some(s) => s.clone(),
            None => Tensor::zeros(
                (b, self.num_v_heads, self.head_v_dim, self.head_v_dim),
                DType::F32,
                device,
            )?,
        };

        let mut output = Tensor::zeros((b, t, self.value_dim), DType::F32, device)?;

        for i in 0..t {
            let q_i = q_conv.narrow(1, i, 1)?.squeeze(1)?.to_dtype(DType::F32)?; // [b, key_dim]
            let k_i = k_conv.narrow(1, i, 1)?.squeeze(1)?.to_dtype(DType::F32)?; // [b, key_dim]
            let v_i = v_conv.narrow(1, i, 1)?.squeeze(1)?.to_dtype(DType::F32)?; // [b, value_dim]
            let alpha_i = alpha.narrow(1, i, 1)?.squeeze(1)?.to_dtype(DType::F32)?; // [b, num_v_heads]
            let beta_i = beta.narrow(1, i, 1)?.squeeze(1)?.to_dtype(DType::F32)?; // [b, num_v_heads]

            let q_i = q_i.reshape((b, self.num_k_heads, self.head_k_dim))?;
            let k_i = k_i.reshape((b, self.num_k_heads, self.head_k_dim))?;
            let v_i = v_i.reshape((b, self.num_v_heads, self.head_v_dim))?;

            let q_i = l2_norm(&q_i, self.rms_norm_eps)?;
            let k_i = l2_norm(&k_i, self.rms_norm_eps)?;

            let scale = 1.0f32 / (self.head_k_dim as f32).sqrt();
            let scale_t = Tensor::new(scale, q_i.device())?.to_dtype(q_i.dtype())?;
            let q_i = q_i.broadcast_mul(&scale_t)?;

            let q_i = if self.num_v_heads != self.num_k_heads {
                let rep = self.num_v_heads / self.num_k_heads;
                q_i.unsqueeze(2)?.expand((b, self.num_k_heads, rep, self.head_k_dim))?
                    .reshape((b, self.num_v_heads, self.head_k_dim))?
            } else {
                q_i
            };
            let k_i = if self.num_v_heads != self.num_k_heads {
                let rep = self.num_v_heads / self.num_k_heads;
                k_i.unsqueeze(2)?.expand((b, self.num_k_heads, rep, self.head_k_dim))?
                    .reshape((b, self.num_v_heads, self.head_k_dim))?
            } else {
                k_i
            };

            let alpha_biased = alpha_i.broadcast_add(&dt_bias)?;
            let alpha_sp = softplus(&alpha_biased)?; // [b, num_v_heads]
            let gate = alpha_sp.broadcast_mul(&ssm_a)?; // [b, num_v_heads]
            let gate_exp = gate.exp()?; // exp(gate) for state decay
            let beta_sig = candle_nn::ops::sigmoid(&beta_i)?; // [b, num_v_heads]

            let state_i = ssm_state.reshape((b * self.num_v_heads, self.head_v_dim, self.head_v_dim))?;

            let gate_exp_i = gate_exp.reshape((b * self.num_v_heads, 1, 1))?;
            let state_decayed = state_i.broadcast_mul(&gate_exp_i)?;

            let q_flat = q_i.reshape((b * self.num_v_heads, 1, self.head_k_dim))?;
            let k_flat = k_i.reshape((b * self.num_v_heads, 1, self.head_k_dim))?;
            let v_flat = v_i.reshape((b * self.num_v_heads, 1, self.head_v_dim))?;

            let k_t = k_flat.transpose(1, 2)?; // [b*nv, head_k_dim, 1] column vector
            let q_t = q_flat.transpose(1, 2)?; // [b*nv, head_k_dim, 1] column vector
            let v_t = v_flat.transpose(1, 2)?; // [b*nv, head_v_dim, 1] column vector

            // sk = state @ k^T  -> [b*nv, head_v_dim, 1] (column vector)
            let sk = state_decayed.matmul(&k_t)?;

            // delta = (v - sk) * beta -> [b*nv, head_v_dim, 1]
            let beta_flat = beta_sig.reshape((b * self.num_v_heads, 1, 1))?;
            let delta = v_t.broadcast_sub(&sk)?.broadcast_mul(&beta_flat)?;

            // kd = delta @ k  (outer product) -> [b*nv, head_v_dim, head_k_dim]
            let kd = delta.matmul(&k_flat)?; // [head_v_dim, 1] @ [1, head_k_dim]
            let new_state = (state_decayed + kd)?;

            // o = new_state @ q^T  -> [b*nv, head_v_dim, 1]
            let attn_out = new_state.matmul(&q_t)?; // [head_v_dim, head_k_dim] @ [head_k_dim, 1]
            let attn_out = attn_out.squeeze(2)?; // [b*nv, head_v_dim]

            ssm_state = new_state.reshape((b, self.num_v_heads, self.head_v_dim, self.head_v_dim))?;

            let attn_out = self.norm.forward(&attn_out)?;

            let z_i = z.narrow(1, i, 1)?.squeeze(1)?.to_dtype(DType::F32)?;
            let z_i = z_i.reshape((b * self.num_v_heads, self.head_v_dim))?;
            let gated = attn_out.broadcast_mul(&candle_nn::ops::silu(&z_i)?)?;

            let gated = gated.reshape((b, self.value_dim))?;
            let gated_unsq = gated.unsqueeze(1)?;
            output.slice_set(&gated_unsq, 1, i)?;
        }

        self.ssm_state = Some(ssm_state);

        let output = output.to_dtype(x.dtype())?;
        self.out_proj.forward(&output)
    }

    fn clear_state(&mut self) {
        self.ssm_state = None;
        self.conv_state = None;
    }
}

enum Layer {
    Full(FullAttention),
    Ssm(SsmAttention),
}

struct LayerWeights {
    layer: Layer,
    mlp: MlpWeights,
    ln1: RmsNorm,
    ln2: RmsNorm,
}

impl LayerWeights {
    fn forward(&mut self, x: &Tensor, mask: Option<&Tensor>, offset: usize) -> Result<Tensor> {
        let h = self.ln1.forward(x)?;
        let h = match &mut self.layer {
            Layer::Full(attn) => attn.forward(&h, mask, offset)?,
            Layer::Ssm(attn) => attn.forward(&h, offset)?,
        };
        let x = (x + h)?;
        let h2 = self.ln2.forward(&x)?;
        let h2 = h2.apply(&self.mlp)?;
        x + h2
    }

    fn clear_cache(&mut self) {
        match &mut self.layer {
            Layer::Full(attn) => attn.clear_kv_cache(),
            Layer::Ssm(attn) => attn.clear_state(),
        }
    }
}

pub struct ModelWeights {
    embed_tokens: Embedding,
    layers: Vec<LayerWeights>,
    norm: RmsNorm,
    lm_head: QMatMul,
    device: Device,
    dtype: DType,
}

impl ModelWeights {
    pub fn from_gguf<R: Read + Seek>(
        ct: gguf_file::Content,
        reader: &mut R,
        device: &Device,
    ) -> Result<Self> {
        let mut gg = Gguf::new(ct, reader, device.clone());
        let md_get = |s: &str| match gg.metadata().get(s) {
            None => candle_core::bail!("cannot find {s} in metadata"),
            Some(v) => Ok(v),
        };

        let num_heads = md_get("qwen35.attention.head_count")?.to_u32()? as usize;
        let num_kv_heads = md_get("qwen35.attention.head_count_kv")?.to_u32()? as usize;
        let head_dim = md_get("qwen35.attention.key_length")?.to_u32()? as usize;
        let value_dim = md_get("qwen35.attention.value_length")?.to_u32()? as usize;
        let block_count_all = md_get("qwen35.block_count")?.to_u32()? as usize;
        let nextn_layers = match gg.metadata().get("qwen35.nextn_predict_layers") {
            Some(v) => v.to_u32().unwrap_or(0) as usize,
            None => 0,
        };
        let num_layers = block_count_all - nextn_layers;
        tracing::info!("Layers: total={}, nextn={}, main={}", block_count_all, nextn_layers, num_layers);
        let hidden_size = md_get("qwen35.embedding_length")?.to_u32()? as usize;
        let max_pos = md_get("qwen35.context_length")?.to_u32()? as usize;
        let rms_norm_eps = md_get("qwen35.attention.layer_norm_rms_epsilon")?.to_f32()? as f64;
        let rope_freq_base = md_get("qwen35.rope.freq_base")?.to_f32()? as f64;
        let rope_dim_count = md_get("qwen35.rope.dimension_count")?.to_u32()? as usize;
        tracing::info!("Attention config: num_heads={}, num_kv_heads={}, head_dim(key)={}, head_dim(value)={}, hidden_size={}, rope_dim_count={}", num_heads, num_kv_heads, head_dim, value_dim, hidden_size, rope_dim_count);
        let ssm_state_size = md_get("qwen35.ssm.state_size")?.to_u32()? as usize;
        let ssm_conv_kernel = md_get("qwen35.ssm.conv_kernel")?.to_u32()? as usize;
        let ssm_inner_size = md_get("qwen35.ssm.inner_size")?.to_u32()? as usize;
        let ssm_time_step_rank = md_get("qwen35.ssm.time_step_rank")?.to_u32()? as usize;
        let ssm_n_group = md_get("qwen35.ssm.group_count")?.to_u32()? as usize;
        let full_attn_interval = md_get("qwen35.full_attention_interval")?.to_u32()? as usize;
        tracing::info!("SSM config: state_size={}, conv_kernel={}, inner_size={}, time_step_rank={}, n_group={}, full_attn_interval={}", ssm_state_size, ssm_conv_kernel, ssm_inner_size, ssm_time_step_rank, ssm_n_group, full_attn_interval);

        let dtype = match gg.metadata().get("general.dtype") {
            Some(v) => match v.to_u32() {
                Ok(0) => DType::F32,
                Ok(1) => DType::F16,
                _ => DType::F16,
            },
            None => DType::F16,
        };

        let embed_tensor = gg.tensor("token_embd.weight")?;
        let embed_tokens = Embedding::new(embed_tensor.dequantize(device)?, hidden_size);

        let rotary = Arc::new(RotaryEmbedding::new(
            dtype,
            rope_dim_count,
            max_pos,
            rope_freq_base,
            device,
        )?);

        let mut layers = Vec::with_capacity(num_layers);
        for i in 0..num_layers {
            let prefix = format!("blk.{i}");
            let ln1 = gg.rms_norm(&format!("{prefix}.attn_norm.weight"), rms_norm_eps)?;
            let ln2 = gg.rms_norm(&format!("{prefix}.post_attention_norm.weight"), rms_norm_eps)?;
            let mlp = MlpWeights::new(&mut gg, &prefix)?;

            let is_full = full_attn_interval > 0 && (i + 1) % full_attn_interval == 0;
            let layer = if is_full {
                Layer::Full(FullAttention::new(
                    &mut gg,
                    num_heads,
                    num_kv_heads,
                    head_dim,
                    rms_norm_eps,
                    rotary.clone(),
                    &prefix,
                )?)
            } else {
                Layer::Ssm(SsmAttention::new(
                    &mut gg,
                    rms_norm_eps,
                    &prefix,
                    ssm_state_size,
                    ssm_conv_kernel,
                    ssm_inner_size,
                    ssm_time_step_rank,
                    ssm_n_group,
                )?)
            };

            layers.push(LayerWeights {
                layer,
                mlp,
                ln1,
                ln2,
            });
        }

        let norm = gg.rms_norm("output_norm.weight", rms_norm_eps)?;
        let lm_head_tensor = match gg.tensor("output.weight") {
            Ok(tensor) => tensor,
            Err(_) => gg.tensor("token_embd.weight")?,
        };
        let lm_head_w = lm_head_tensor.dequantize(device)?;
        tracing::info!("lm_head weight shape: {:?}", lm_head_w.shape());
        let lm_head = QMatMul::from_weights(lm_head_tensor.into())?;

        Ok(Self {
            embed_tokens,
            layers,
            norm,
            lm_head,
            device: device.clone(),
            dtype,
        })
    }

    fn causal_mask(&self, b: usize, tgt: usize, offset: usize) -> Result<Tensor> {
        let minf = -1e9f32;
        let mask: Vec<_> = (0..tgt)
            .flat_map(|i| {
                (0..(tgt + offset)).map(move |j| {
                    if j <= i + offset {
                        0.
                    } else {
                        minf
                    }
                })
            })
            .collect();
        Tensor::from_slice(&mask, (b, 1, tgt, tgt + offset), &self.device)?.to_dtype(self.dtype)
    }

    pub fn forward(&mut self, input: &Tensor, offset: usize) -> Result<Tensor> {
        let (b, l) = input.dims2()?;
        let mut h = self.embed_tokens.forward(input)?;
        let causal_mask = if l == 1 {
            None
        } else {
            Some(self.causal_mask(b, l, offset)?)
        };
        for (_idx, layer) in self.layers.iter_mut().enumerate() {
            h = layer.forward(&h, causal_mask.as_ref(), offset)?;
        }
        let h = self.norm.forward(&h)?;
        let last_hidden = h.narrow(1, l - 1, 1)?;
        let logits = self.lm_head.forward(&last_hidden)?;
        let logits = logits.flatten(0, logits.rank() - 1)?;
        Ok(logits)
    }

    pub fn clear_cache(&mut self) {
        for layer in &mut self.layers {
            layer.clear_cache();
        }
    }
}

// Pairwise lagged correlation + circular-shift permutation.
// WebGPU when the browser can see the AMD adapter; typed-array CPU otherwise.
// Circular shifts keep each series' own autocorrelation. Shuffling iid would not.

const SHADER = `
struct Params { n: u32, t: u32, nLags: u32, nShifts: u32 }
@group(0) @binding(0) var<storage, read> series: array<f32>;
@group(0) @binding(1) var<storage, read> lags: array<u32>;
@group(0) @binding(2) var<storage, read> shifts: array<u32>;
@group(0) @binding(3) var<storage, read_write> outR: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let nJobs = params.n * params.n * params.nLags * params.nShifts;
  if (idx >= nJobs) { return; }
  var rem = idx;
  let shiftIdx = rem % params.nShifts; rem = rem / params.nShifts;
  let lagIdx = rem % params.nLags; rem = rem / params.nLags;
  let j = rem % params.n; rem = rem / params.n;
  let i = rem;
  if (i == j) { outR[idx] = 0.0; return; }
  let lag = lags[lagIdx];
  let shift = shifts[shiftIdx];
  if (params.t <= lag) { outR[idx] = 0.0; return; }
  let nobs = params.t - lag;
  if (nobs < 8u) { outR[idx] = 0.0; return; }
  var sx = 0.0;
  var sy = 0.0;
  var sxx = 0.0;
  var syy = 0.0;
  var sxy = 0.0;
  let iOff = i * params.t;
  let jOff = j * params.t;
  for (var t = 0u; t < nobs; t = t + 1u) {
    let xv = series[iOff + ((t + shift) % params.t)];
    let yv = series[jOff + (t + lag)];
    sx += xv; sy += yv;
    sxx += xv * xv; syy += yv * yv; sxy += xv * yv;
  }
  let nf = f32(nobs);
  let mx = sx / nf;
  let my = sy / nf;
  let vx = sxx / nf - mx * mx;
  let vy = syy / nf - my * my;
  let cv = sxy / nf - mx * my;
  let d = sqrt(max(vx, 0.0) * max(vy, 0.0));
  outR[idx] = select(0.0, cv / d, d > 1e-12);
}
`;

export function yieldToUi() {
  return new Promise((r) => setTimeout(r, 0));
}

export function corrShift(x, y, T, lag, shift) {
  const n = T - lag;
  if (n < 8) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let t = 0; t < n; t++) {
    const xv = x[(t + shift) % T];
    const yv = y[t + lag];
    sx += xv; sy += yv;
    sxx += xv * xv; syy += yv * yv; sxy += xv * yv;
  }
  const mx = sx / n, my = sy / n;
  const vx = sxx / n - mx * mx;
  const vy = syy / n - my * my;
  const cv = sxy / n - mx * my;
  const d = Math.sqrt(Math.max(vx, 0) * Math.max(vy, 0));
  return d > 1e-12 ? cv / d : 0;
}

export function makeShifts(T, maxLag, nPerms, seed = 20261011) {
  const lo = Math.max(maxLag, 8);
  const hi = Math.max(lo + 1, T - maxLag);
  const want = new Set([0]);
  let s = seed || 1;
  let guard = 0;
  while (want.size < nPerms + 1 && guard++ < nPerms * 20) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const span = hi - lo;
    if (span <= 1) break;
    want.add(lo + (s % span));
  }
  return [...want];
}

function pValue(ge, nPerms) {
  return (1 + ge) / (1 + nPerms);
}

export async function scanLagCorrelations(series, n, T, lags, nPerms, onProgress) {
  try {
    const gpu = await tryGpuScan(series, n, T, lags, nPerms, onProgress);
    if (gpu) return gpu;
  } catch (e) {
    console.warn('Midas proxy: GPU path failed, using CPU.', e);
  }
  return cpuScan(series, n, T, lags, nPerms, onProgress);
}

async function tryGpuScan(series, n, T, lags, nPerms, onProgress) {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;
  let adapter;
  try { adapter = await gpu.requestAdapter(); } catch { return null; }
  if (!adapter) return null;
  let device;
  try { device = await adapter.requestDevice(); } catch { return null; }

  const shifts = makeShifts(T, Math.max(...lags), nPerms);
  const nShifts = shifts.length;
  const nJobs = n * n * lags.length * nShifts;
  onProgress?.('Running permutations on the GPU…', 0.15);

  const seriesF = series instanceof Float32Array ? series : Float32Array.from(series);
  const seriesBuf = device.createBuffer({ size: seriesF.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const lagsBuf = device.createBuffer({ size: lags.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const shiftsBuf = device.createBuffer({ size: nShifts * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const outSize = nJobs * 4;
  const outBuf = device.createBuffer({ size: outSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: outSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const uniBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  device.queue.writeBuffer(seriesBuf, 0, seriesF);
  device.queue.writeBuffer(lagsBuf, 0, Uint32Array.from(lags));
  device.queue.writeBuffer(shiftsBuf, 0, Uint32Array.from(shifts));
  device.queue.writeBuffer(uniBuf, 0, Uint32Array.from([n, T, lags.length, nShifts]));

  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: seriesBuf } },
      { binding: 1, resource: { buffer: lagsBuf } },
      { binding: 2, resource: { buffer: shiftsBuf } },
      { binding: 3, resource: { buffer: outBuf } },
      { binding: 4, resource: { buffer: uniBuf } },
    ],
  });

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.ceil(nJobs / 64));
  pass.end();
  enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, outSize);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const raw = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  device.destroy();

  onProgress?.('Tallying permutation p-values…', 0.85);
  return packScan(raw, n, lags, shifts, 'gpu');
}

async function cpuScan(series, n, T, lags, nPerms, onProgress) {
  const shifts = makeShifts(T, Math.max(...lags), nPerms);
  const nShifts = shifts.length;
  const nLags = lags.length;
  const observed = new Float32Array(n * n * nLags);
  const ge = new Uint32Array(n * n * nLags);
  const x = series instanceof Float32Array ? series : Float32Array.from(series);
  let done = 0;
  const total = n * (n - 1);
  onProgress?.('Running circular-shift permutations on the CPU…', 0.05);

  for (let i = 0; i < n; i++) {
    const xi = x.subarray(i * T, i * T + T);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const yj = x.subarray(j * T, j * T + T);
      for (let li = 0; li < nLags; li++) {
        const lag = lags[li];
        const slot = (i * n + j) * nLags + li;
        const r0 = corrShift(xi, yj, T, lag, 0);
        observed[slot] = r0;
        const abs0 = Math.abs(r0);
        let count = 0;
        for (let p = 1; p < nShifts; p++) {
          if (Math.abs(corrShift(xi, yj, T, lag, shifts[p])) >= abs0) count++;
        }
        ge[slot] = count;
      }
      done++;
      if (done % 16 === 0) {
        onProgress?.('Testing directed pairs…', 0.05 + 0.9 * (done / total));
        await yieldToUi();
      }
    }
  }

  const nPermsUsed = nShifts - 1;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (let li = 0; li < nLags; li++) {
        const slot = (i * n + j) * nLags + li;
        pairs.push({
          i, j, lag: lags[li],
          r: observed[slot],
          p: pValue(ge[slot], nPermsUsed),
        });
      }
    }
  }
  return { pairs, engine: 'cpu', nPerms: nPermsUsed };
}

function packScan(raw, n, lags, shifts, engine) {
  const nLags = lags.length;
  const nShifts = shifts.length;
  const nPermsUsed = nShifts - 1;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (let li = 0; li < nLags; li++) {
        const base = ((i * n + j) * nLags + li) * nShifts;
        const r0 = raw[base];
        const abs0 = Math.abs(r0);
        let count = 0;
        for (let p = 1; p < nShifts; p++) {
          if (Math.abs(raw[base + p]) >= abs0) count++;
        }
        pairs.push({ i, j, lag: lags[li], r: r0, p: pValue(count, nPermsUsed) });
      }
    }
  }
  return { pairs, engine, nPerms: nPermsUsed };
}

'use strict';
// CPU, memory and GPU readings for the System widget. Linux only; anything missing is reported as null.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SYS = process.env.AQUA_SYSFS || '/sys';
const PROC = process.env.AQUA_PROCFS || '/proc';

const readNum = async f => { try { const v = Number((await fsp.readFile(f, 'utf8')).trim()); return Number.isFinite(v) ? v : null; } catch (e) { return null; } };
const readStr = async f => { try { return (await fsp.readFile(f, 'utf8')).trim(); } catch (e) { return null; } };
const ls = async d => { try { return await fsp.readdir(d); } catch (e) { return []; } };

class SysInfo {
  constructor() {
    this.prev = null;
    this.cpuTempFile = undefined;   // resolved on first read
    this.gpu = undefined;           // { kind: 'amd', dir, hwmon } | { kind: 'nvidia' } | null
    this.nvidiaFailed = false;
  }

  cpuUsage() {
    const t = os.cpus().reduce((a, c) => {
      const v = c.times;
      a.idle += v.idle; a.total += v.user + v.nice + v.sys + v.idle + v.irq;
      return a;
    }, { idle: 0, total: 0 });
    const p = this.prev; this.prev = t;
    if (!p || t.total <= p.total) return null;
    return Math.max(0, Math.min(100, 100 * (1 - (t.idle - p.idle) / (t.total - p.total))));
  }

  async memory() {
    const txt = await readStr(path.join(PROC, 'meminfo'));
    const total = os.totalmem();
    if (txt) {
      const m = /MemAvailable:\s+(\d+)\s+kB/.exec(txt);
      if (m) return { used: total - Number(m[1]) * 1024, total };
    }
    return { used: total - os.freemem(), total };
  }

  async findCpuTemp() {
    const base = path.join(SYS, 'class', 'hwmon');
    const prefer = ['k10temp', 'coretemp', 'zenpower', 'cpu_thermal', 'soc_thermal'];
    const found = [];
    for (const h of await ls(base)) {
      const name = await readStr(path.join(base, h, 'name'));
      if (!name) continue;
      const rank = prefer.indexOf(name);
      if (rank >= 0) found.push({ rank, file: path.join(base, h, 'temp1_input') });
    }
    found.sort((a, b) => a.rank - b.rank);
    if (found.length) return found[0].file;
    const tz = path.join(SYS, 'class', 'thermal');
    for (const z of await ls(tz)) {
      const type = await readStr(path.join(tz, z, 'type'));
      if (type && /x86_pkg_temp|cpu/i.test(type)) return path.join(tz, z, 'temp');
    }
    return null;
  }

  async findGpu() {
    const drm = path.join(SYS, 'class', 'drm');
    for (const c of await ls(drm)) {
      if (!/^card\d+$/.test(c)) continue;
      const dev = path.join(drm, c, 'device');
      if ((await readNum(path.join(dev, 'gpu_busy_percent'))) == null) continue;
      let hw = null;
      for (const h of await ls(path.join(dev, 'hwmon'))) { hw = path.join(dev, 'hwmon', h, 'temp1_input'); break; }
      return { kind: 'amd', dir: dev, hwmon: hw };
    }
    return { kind: 'nvidia' };
  }

  nvidia() {
    if (this.nvidiaFailed) return Promise.resolve(null);
    return new Promise(resolve => {
      execFile('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 1500 }, (err, out) => {
        if (err) { if (err.code === 'ENOENT') this.nvidiaFailed = true; resolve(null); return; }
        const [u, t] = String(out).split('\n')[0].split(',').map(x => Number(x.trim()));
        resolve(Number.isFinite(u) ? { util: u, temp: Number.isFinite(t) ? t : null } : null);
      });
    });
  }

  async read() {
    if (this.cpuTempFile === undefined) this.cpuTempFile = await this.findCpuTemp();
    if (this.gpu === undefined) this.gpu = await this.findGpu();
    const cpu = this.cpuUsage();
    const raw = this.cpuTempFile ? await readNum(this.cpuTempFile) : null;
    let gpu = null;
    if (this.gpu && this.gpu.kind === 'amd') {
      const util = await readNum(path.join(this.gpu.dir, 'gpu_busy_percent'));
      const t = this.gpu.hwmon ? await readNum(this.gpu.hwmon) : null;
      gpu = { util, temp: t != null ? t / 1000 : null };
    } else if (this.gpu && this.gpu.kind === 'nvidia') {
      gpu = await this.nvidia();
      if (!gpu && this.nvidiaFailed) this.gpu = null;
    }
    return { cpu, cpuTemp: raw != null ? raw / 1000 : null, mem: await this.memory(), gpu, at: Date.now() };
  }
}

module.exports = { SysInfo };

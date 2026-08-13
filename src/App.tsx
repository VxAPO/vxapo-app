import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import "./new.css";
import { listDevices, readConfig, writeConfig } from "./lib/api";
import type { Block, Device, PresetLibraryEntry, SideSection, ViewMode } from "./lib/model";
import { buildToml, parseConfigWithTail } from "./lib/toml";
import logoUrl from "./assets/VxAPO_icon_v4.svg";
import GainSlider from "./components/GainSlider";
import VxSelect from "./components/VxSelect";
import VxSwitch from "./components/VxSwitch";

const LIBRARY: PresetLibraryEntry[] = [
  { id: "fps-step", group: "FPS 预设", name: "脚步声增强", desc: "突出脚步与位移细节，听声辨位更清楚", bands: [{ fc: 250, gain_db: 4, q: 1.2 }] },
  { id: "fps-gun", group: "FPS 预设", name: "枪声增强", desc: "强化枪声辨识度与提示音穿透力", bands: [{ fc: 3200, gain_db: 3, q: 2 }] },
  { id: "cinema", group: "深夜影院", name: "低频下沉", desc: "提升氛围感，低音更沉更稳", bands: [{ fc: 80, gain_db: 3, q: 0.9 }] },
];

type ThemeMode = "light" | "dark" | "system";
const THEME_LABEL: Record<ThemeMode, string> = { light: "浅色", dark: "深色", system: "跟随系统" };

function isInstalled(d: Device): boolean {
  return (
    !!d.installed_version ||
    Object.values(d.slots).some((v) => typeof v === "string" && v.toLowerCase().includes("vxapo"))
  );
}

function friendlyError(e: unknown): string {
  const msg = String(e);
  if (/os error 5/i.test(msg)) return "权限不足，无法读写配置（请以管理员身份运行一次以修复权限）";
  return msg;
}

function logX(freq: number, w: number): number {
  const t = (Math.log10(Math.max(20, Math.min(20000, freq))) - Math.log10(20)) / 3;
  return 40 + t * (w - 80);
}

function dbY(db: number): number {
  return 62 - (db / 22) * 140;
}

function peakingDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const f = Math.max(10, Math.min(fs * 0.49, freq));
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cw;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cw;
  const a2 = 1 - alpha / a;
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const num = Math.hypot(b0 + b1 * c + b2 * c2, b1 * s + b2 * s2);
  const den = Math.hypot(a0 + a1 * c + a2 * c2, a1 * s + a2 * s2);
  return 20 * Math.log10(num / den);
}

function freqPath(blocks: Block[], fs: number, w: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 240; i++) {
    const f = 20 * Math.pow(1000, i / 240);
    let db = 0;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += peakingDb(f, band.fc, band.gain_db, band.q, fs);
    }
    pts.push(`${logX(f, w).toFixed(1)} ${dbY(Math.max(-16, Math.min(6, db))).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [view, setView] = useState<ViewMode>("preset");
  const [side, setSide] = useState<SideSection>("preset");
  const [saved, setSaved] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [tuning, setTuning] = useState(true);
  const [tuningMap, setTuningMap] = useState<Record<string, boolean>>({});
  const [channelOn, setChannelOn] = useState(false);
  const [curveChannel, setCurveChannel] = useState("左声道");
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [curveW, setCurveW] = useState(640);
  const saveTimer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const curveRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef("");

  const selected = devices.find((d) => d.guid === selectedGuid) ?? null;
  const installedDevices = useMemo(() => devices.filter(isInstalled), [devices]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listDevices()
        .then((ds) => {
          if (!alive) return;
          setDevices(ds);
          setSelectedGuid((prev) => {
            if (prev && ds.some((d) => d.guid === prev)) return prev;
            return ds.find(isInstalled)?.guid ?? null;
          });
        })
        .catch((e: unknown) => {
          if (alive) setLoadErr(friendlyError(e));
        });
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedGuid) return;
    setLoaded(false);
    readConfig(selectedGuid)
      .then((text) => {
        try {
          const parsed = parseConfigWithTail(text);
          setBlocks(parsed.blocks);
          tailRef.current = parsed.tail;
          setTuningMap((prev) => ({ ...prev, [selectedGuid]: parsed.enabled }));
        } catch {
          setBlocks([]);
          tailRef.current = "";
        }
        setLoadErr("");
        setLoaded(true);
      })
      .catch((e: unknown) => {
        setBlocks([]);
        tailRef.current = "";
        setLoadErr(friendlyError(e));
        setLoaded(true);
      });
  }, [selectedGuid]);

  useEffect(() => {
    const el = curveRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setCurveW(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 监控 config 目录热更新：外部/驱动改写 config.toml 时自动刷新 UI（编辑中跳过，避免覆盖手头改动）
  useEffect(() => {
    if (!selectedGuid || !loaded) return;
    const timer = window.setInterval(() => {
      if (dirtyRef.current) return;
      readConfig(selectedGuid)
        .then((text) => {
          if (dirtyRef.current) return;
          const parsed = parseConfigWithTail(text);
          tailRef.current = parsed.tail;
          setTuningMap((prev) => ({ ...prev, [selectedGuid]: parsed.enabled }));
          setBlocks((prev) =>
            JSON.stringify(prev) === JSON.stringify(parsed.blocks) ? prev : parsed.blocks,
          );
        })
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedGuid, loaded]);

  // 自动保存（300ms 去抖，原子写由 Rust 侧负责）
  useEffect(() => {
    if (!selectedGuid || !loaded || !dirtyRef.current) return;
    setSaved(false);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const effective = tuning && (tuningMap[selectedGuid] ?? true);
      const content = buildToml(blocks, effective) + tailRef.current;
      writeConfig(selectedGuid, content)
        .then(() => {
          setSaved(true);
          dirtyRef.current = false;
        })
        .catch((e: unknown) => setLoadErr(friendlyError(e)));
    }, 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [blocks, tuning, tuningMap, selectedGuid, loaded]);

  const applyPreset = (p: PresetLibraryEntry) => {
    dirtyRef.current = true;
    setBlocks((prev) => [
      ...prev,
      { group: p.group, name: p.name, enabled: true, bands: p.bands.map((b) => ({ ...b })) },
    ]);
  };

  const addBand = () => {
    dirtyRef.current = true;
    setBlocks((prev) => [...prev, { enabled: true, bands: [{ fc: 1000, gain_db: 0, q: 1 }] }]);
  };

  const removeBlock = (idx: number) => {
    dirtyRef.current = true;
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  };

  const patchBlock = (idx: number, patch: Partial<Block>) => {
    dirtyRef.current = true;
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const patchBand = (blockIdx: number, bandIdx: number, patch: Partial<{ fc: number; gain_db: number; q: number }>) => {
    dirtyRef.current = true;
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIdx
          ? { ...b, bands: b.bands.map((band, j) => (j === bandIdx ? { ...band, ...patch } : band)) }
          : b,
      ),
    );
  };

  const themeApplied = theme === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = themeApplied;
  }, [themeApplied]);

  const groups = useMemo(() => {
    const out: { label: string; items: { block: Block; idx: number }[] }[] = [];
    const seen = new Map<string, typeof out[number]>();
    blocks.forEach((b, idx) => {
      if (!b.group) return;
      let g = seen.get(b.group);
      if (!g) {
        g = { label: b.group, items: [] };
        seen.set(b.group, g);
        out.push(g);
      }
      g.items.push({ block: b, idx });
    });
    return out;
  }, [blocks]);

  const renderOrder = useMemo(() => {
    const out: ({ kind: "group"; g: { label: string; items: { block: Block; idx: number }[] }; ord: number } | { kind: "standalone"; block: Block; idx: number })[] = [];
    const emitted = new Set<string>();
    blocks.forEach((b, idx) => {
      if (!b.group) {
        out.push({ kind: "standalone", block: b, idx });
        return;
      }
      if (emitted.has(b.group)) return;
      emitted.add(b.group);
      const g = groups.find((x) => x.label === b.group)!;
      out.push({ kind: "group", g, ord: idx + 1 });
    });
    return out;
  }, [blocks, groups]);

  const renderNameCard = (block: Block, idx: number) => (
    <div className="name-card" key={idx}>
      <button className="close-x" type="button" aria-label="删除" onClick={() => removeBlock(idx)}>✕</button>
      <span className="n-name">{block.name || "未命名"}</span>
      <span className="n-sub">{block.bands[0] ? `${block.bands[0].fc}Hz` : "—"}</span>
      <div className="fader-row">
        <GainSlider
          min={-12}
          max={12}
          value={block.bands[0]?.gain_db ?? 0}
          onValueChange={(v) => patchBand(idx, 0, { gain_db: v })}
        />
        <span className="g-val">{((block.bands[0]?.gain_db ?? 0) >= 0 ? "+" : "")}{(block.bands[0]?.gain_db ?? 0).toFixed(1)}</span>
      </div>
    </div>
  );

  const curveD = useMemo(
    () => freqPath(blocks, selected?.sample_rate ?? 48000, curveW),
    [blocks, selected?.sample_rate, curveW],
  );

  const xGrid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => logX(f, curveW));
  const xLabels = ["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"];
  const yGrid = [6, 4, 2, 0, -2, -4, -6, -8, -10, -12, -14, -16].map((db) => ({ db, y: dbY(db) }));

  const deviceTuningOn = (guid: string) => tuning && (tuningMap[guid] ?? true);
  const toggleDeviceTuning = (guid: string) => {
    const next = !deviceTuningOn(guid);
    dirtyRef.current = true;
    setTuningMap((prev) => ({ ...prev, [guid]: next }));
    if (next && !tuning) setTuning(true);
  };

  const minimizeWindow = () => {
    try { void getCurrentWindow().minimize(); } catch { /* web fallback */ }
  };
  const toggleMaximizeWindow = () => {
    try { void getCurrentWindow().toggleMaximize(); } catch { /* web fallback */ }
  };
  const closeWindow = () => {
    try { void getCurrentWindow().close(); } catch { /* web fallback */ }
  };

  const fmtDevInfo = () => {
    if (!selected) return "未选择设备";
    const ch = selected.channels != null ? `${selected.channels}ch` : "—";
    const sr = selected.sample_rate != null ? `${selected.sample_rate}Hz` : "—";
    const bd = selected.bit_depth != null ? `${selected.bit_depth}bit` : "—";
    return `${ch} · ${sr} · ${bd}`;
  };

  return (
    <div className="app-shell-new">
      <div className="topbar" data-tauri-drag-region>
        <img className="logo" src={logoUrl} alt="VxAPO" draggable={false} />
        <button className="pill" type="button">设置</button>
        <button className="pill saved-dot" type="button" title={saved ? "已保存" : "未保存"} onClick={() => {
          if (selectedGuid) {
            const effective = tuning && (tuningMap[selectedGuid] ?? true);
            const content = buildToml(blocks, effective) + tailRef.current;
            writeConfig(selectedGuid, content)
              .then(() => {
                setSaved(true);
                dirtyRef.current = false;
              })
              .catch((e: unknown) => setLoadErr(friendlyError(e)));
          }
        }}>保存</button>
        <button className="pill" type="button">导入</button>
        <button className="pill" type="button">导出</button>
        <span className="spacer" data-tauri-drag-region />
        <div className="seg" role="group" aria-label="视图切换">
          <button type="button" disabled={channelOn} aria-pressed={view === "preset"} onClick={() => setView("preset")}>预设</button>
          <button type="button" aria-pressed={view === "advanced"} onClick={() => setView("advanced")}>高级</button>
        </div>
        <button className="pill winbtn" type="button" aria-label="最小化" onClick={minimizeWindow}>─</button>
        <button className="pill winbtn" type="button" aria-label="最大化" onClick={toggleMaximizeWindow}>□</button>
        <button className="pill winbtn close" type="button" aria-label="关闭" onClick={closeWindow}>✕</button>
      </div>

      <div className="main">
        <aside className="sidebar">
          <div className="side-seg">
            <div className="labels">
              {(["preset", "custom", "advanced"] as SideSection[]).map((s) => (
                <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}>
                  {s === "preset" ? "预设" : s === "custom" ? "自定义" : "高级"}
                </button>
              ))}
            </div>
            <div className="track" />
            <div className="ind" style={{ left: `${(side === "preset" ? 0 : side === "custom" ? 1 : 2) * 33.33}%`, width: "33.33%" }} />
          </div>

          {side === "preset" && (
            <div className="cards">
              {LIBRARY.map((p) => (
                <div className="preset-card" key={p.id}>
                  <p className="p-name">{p.group} · {p.name}</p>
                  <p className="p-desc">{p.desc}</p>
                  <div className="row">
                    <span className="sub">{p.bands.length} 段</span>
                    <button className="add" type="button" onClick={() => applyPreset(p)}>添加</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {side === "custom" && (
            <div className="cards">
              <div className="preset-card">
                <p className="p-desc">暂无自定义预设，在高级视图中将 peaking 拖拽成组后可保存</p>
              </div>
            </div>
          )}

          {side === "advanced" && (
            <div className="adv-list">
              <div className="adv-item"><span>滤波器</span><span className="sub">Peak 可用</span></div>
              <div className="adv-item"><span style={{ paddingLeft: 16 }}>Peak</span><button className="circ-plus" type="button" aria-label="添加 Peak" onClick={addBand}>+</button></div>
              <div className="adv-item disabled"><span style={{ paddingLeft: 16 }}>高架 / 低架 / 低通 / 高通</span><span className="sub">未实现</span></div>
              <div className="adv-item"><span>效果器</span><span className="sub">Wide · Aural · Reverb · Maximizer · Loudness</span></div>
              <div className="adv-item" onClick={() => setChannelOn((v) => !v)}>
                <span>通道选择器</span><button className={`circ-plus ${channelOn ? "on" : ""}`} type="button" aria-label="通道选择器">+</button>
              </div>
              <div className="adv-item"><span>通道</span></div>
              <div className="adv-item"><span style={{ paddingLeft: 16 }}>左声道</span><button className="circ-plus" type="button" aria-label="添加左声道">+</button></div>
              <div className="adv-item"><span style={{ paddingLeft: 16 }}>右声道</span><button className="circ-plus" type="button" aria-label="添加右声道">+</button></div>
            </div>
          )}

          <div className="side-status">
            <button className="pill" type="button">简体中文</button>
            <button className="pill" type="button" onClick={() => setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"))}>{THEME_LABEL[theme]}</button>
            <button
              className="pill"
              type="button"
              onClick={() => {
                dirtyRef.current = true;
                setTuning((v) => !v);
              }}
            >调音：{tuning ? "开" : "关"}</button>
          </div>
        </aside>

        <main className="content">
          <div className="tab-bar">
            <div className="tab-group">
              {installedDevices.map((d, i) => (
                <Fragment key={d.guid}>
                  {i > 0 && <span className="tab-sep" />}
                  <div className={`tab-item ${d.guid === selectedGuid ? "active" : ""}`}>
                    <button
                      className={`tab-dot ${deviceTuningOn(d.guid) ? "on" : ""}`}
                      type="button"
                      aria-label={deviceTuningOn(d.guid) ? "关闭该设备调音" : "开启该设备调音"}
                      title={deviceTuningOn(d.guid) ? "调音已开启，点击关闭" : "调音已关闭，点击开启"}
                      onClick={() => toggleDeviceTuning(d.guid)}
                    />
                    <button className="tab-btn" type="button" onClick={() => setSelectedGuid(d.guid)}>
                      {d.name}
                    </button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="tab-add" type="button" aria-label="新设备安装">+</button>
          </div>

          <div className="device-body">
            {loadErr && <div className="hint-row show err">{loadErr}</div>}
            {!loadErr && view === "preset" && (
              <>
                {blocks.length === 0 && <div className="hint-row show">从预设栏添加调音</div>}
                <div className="cards device-cards">
                  {renderOrder.map((item) =>
                    item.kind === "standalone" ? (
                      <div className="group-card standalone" key={item.idx}>
                        <button className="close-x" type="button" aria-label="删除" onClick={() => removeBlock(item.idx)}>✕</button>
                        <div className="group-head">
                          <span className="ord">{String(item.idx + 1).padStart(2, "0")}</span>
                          <span className="g-name">{item.block.name || "未命名"}</span>
                          <span className="grow" />
                        </div>
                        <div className="fader-row">
                          <GainSlider
                            min={-12}
                            max={12}
                            value={item.block.bands[0]?.gain_db ?? 0}
                            onValueChange={(v) => patchBand(item.idx, 0, { gain_db: v })}
                          />
                          <span className="g-val">
                            {((item.block.bands[0]?.gain_db ?? 0) >= 0 ? "+" : "")}
                            {(item.block.bands[0]?.gain_db ?? 0).toFixed(1)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="group-card" key={item.g.label}>
                        <div className="group-head">
                          <span className="ord">{String(item.ord).padStart(2, "0")}</span>
                          <span className="g-name">{item.g.label}</span>
                          <span className="grow" />
                          <span className="pill-sm">{item.g.items.length} 卡</span>
                        </div>
                        <div className="name-cards">
                          {item.g.items.map(({ block, idx }) => renderNameCard(block, idx))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </>
            )}

            {!loadErr && view === "advanced" && (
              <>
                {channelOn && (
                  <div className="col-head">
                    <span className="ch-name">通道（2）</span>
                    <span className="ch-pill active">左声道</span>
                    <span className="ch-pill">右声道</span>
                    <button className="ch-mgmt" type="button">管理</button>
                  </div>
                )}
                <div className="cards device-cards">
                  {blocks.map((b, bi) => {
                    const band = b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 };
                    return (
                      <div className="band-card" key={bi}>
                        <button className="close-x" type="button" aria-label="删除" onClick={() => removeBlock(bi)}>✕</button>
                        <div className="b-head">
                          <span className="ord sm">{String(bi + 1).padStart(2, "0")}</span>
                          <span className="b-type">PEAK</span>
                          <span className="grow" />
                          <VxSwitch checked={b.enabled} onCheckedChange={(v) => patchBlock(bi, { enabled: v })} label="启用" />
                        </div>
                        <div className="b-row"><label>Fc</label><input type="number" value={band.fc} onChange={(e) => patchBand(bi, 0, { fc: Number(e.target.value) })} /></div>
                        <div className="b-row"><label>Q</label><input type="number" step={0.01} value={band.q} onChange={(e) => patchBand(bi, 0, { q: Number(e.target.value) })} /></div>
                        <div className="b-row">
                          <label>Gain</label>
                          <GainSlider min={-30} max={30} value={band.gain_db} onValueChange={(v) => patchBand(bi, 0, { gain_db: v })} />
                          <span className="g-val">{band.gain_db >= 0 ? "+" : ""}{band.gain_db.toFixed(1)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="curve-wrap" ref={curveRef}>
              <div className="curve-head">
                <span className="t">频响曲线</span>
                {view === "advanced" && (
                  <VxSelect
                    value={curveChannel}
                    options={[
                      { value: "左声道", label: "左声道" },
                      { value: "右声道", label: "右声道" },
                    ]}
                    onValueChange={setCurveChannel}
                    ariaLabel="声道"
                  />
                )}
                <span className="dev-info">{fmtDevInfo()}</span>
              </div>
              <svg viewBox={`0 0 ${curveW} 190`} width="100%" height="190" preserveAspectRatio="none" role="img" aria-label="频响曲线">
                {yGrid.map(({ db, y }) => (
                  <line key={`y${db}`} x1="40" y1={y} x2={curveW - 40} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
                ))}
                {xGrid.map((x, i) => (
                  <line key={`x${i}`} x1={x} y1="24" x2={x} y2="164" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
                ))}
                <line x1="40" y1="24" x2="40" y2="164" stroke="var(--border-strong)" strokeWidth="1.5" />
                <line x1="40" y1="164" x2={curveW - 40} y2="164" stroke="var(--border-strong)" strokeWidth="1.5" />
                <path
                  d={curveD}
                  fill="none"
                  stroke="var(--brand-deep)"
                  strokeWidth="2"
                />
                <g fill="var(--text-secondary)" fontSize="10">
                  {xLabels.map((f, i) => (
                    <text key={f} x={xGrid[i]} y="178" textAnchor="middle">{f}</text>
                  ))}
                  {yGrid.map(({ db, y }) => (
                    <text key={`l${db}`} x="34" y={y + 3} textAnchor="end">{db >= 0 ? `+${db}` : `${db}`}</text>
                  ))}
                </g>
              </svg>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

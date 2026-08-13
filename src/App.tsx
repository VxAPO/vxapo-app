import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import "./new.css";
import { listDevices, readConfig, writeConfig } from "./lib/api";
import type { Block, Device, PresetLibraryEntry, SideSection, ViewMode } from "./lib/model";
import { buildToml, parseConfigWithTail } from "./lib/toml";
import logoUrl from "./assets/VxAPO_icon_v4.svg";
import { Copy, Minus, Plus, SlidersHorizontal, Square, Tags, X } from "lucide-react";
import GainSlider from "./components/GainSlider";
import SettingsDialog from "./components/SettingsDialog";
import VxSelect from "./components/VxSelect";
import VxSwitch from "./components/VxSwitch";

const LIBRARY: PresetLibraryEntry[] = [
  { id: "fps-step", group: "FPS 预设", name: "脚步声增强", desc: "突出脚步与位移细节，听声辨位更清楚", bands: [{ fc: 250, gain_db: 4, q: 1.2 }] },
  { id: "fps-gun", group: "FPS 预设", name: "枪声增强", desc: "强化枪声辨识度与提示音穿透力", bands: [{ fc: 3200, gain_db: 3, q: 2 }] },
  { id: "cinema", group: "深夜影院", name: "低频下沉", desc: "提升氛围感，低音更沉更稳", bands: [{ fc: 80, gain_db: 3, q: 0.9 }] },
];

type ThemeMode = "light" | "dark" | "system";

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

const PERCEPTUAL_RANGES: [number, number, string][] = [
  [20, 40, "极低频下潜感"],
  [40, 80, "低频冲击感"],
  [80, 160, "中低频温暖感"],
  [160, 300, "中低频浑浊感"],
  [300, 500, "中频鼻音感"],
  [500, 800, "中频坚实感"],
  [800, 1300, "中频临场感"],
  [1300, 2600, "中高频咬字感"],
  [2600, 3600, "高频齿音感"],
  [3600, 5100, "高频穿透感"],
  [5100, 8000, "极高频锐利感"],
  [8000, 12000, "极高频空气感"],
  [12000, 16000, "极高频光泽感"],
  [16000, 20000, "极高频延伸感"],
];

function perceptualLabel(fc: number): string {
  for (const [lo, hi, label] of PERCEPTUAL_RANGES) {
    if (fc >= lo && fc < hi) return label;
  }
  return fc >= 20000 ? "极高频延伸感" : "—";
}

function semanticName(block: Block): string {
  const n = block.name?.trim() ?? "";
  const isDefault = !n || n === "未命名" || /立体声\s*EQ/i.test(n);
  if (isDefault) {
    return block.bands[0] ? perceptualLabel(block.bands[0].fc) : n || "未命名";
  }
  return n;
}

function logX(freq: number, w: number): number {
  const t = (Math.log10(Math.max(20, Math.min(20000, freq))) - Math.log10(20)) / 3;
  return 40 + t * (w - 80);
}

function dbY(db: number): number {
  return 62 - (db / 22) * 180;
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
  const [isMax, setIsMax] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [tuningMap, setTuningMap] = useState<Record<string, boolean>>({});
  const [channelOn, setChannelOn] = useState(false);
  const [curveChannel, setCurveChannel] = useState("左声道");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [segDir, setSegDir] = useState<"left" | "right">("right");
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
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const effective = tuningMap[selectedGuid] ?? true;
      const content = buildToml(blocks, effective) + tailRef.current;
      writeConfig(selectedGuid, content)
        .then(() => {
          dirtyRef.current = false;
        })
        .catch((e: unknown) => setLoadErr(friendlyError(e)));
    }, 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [blocks, tuningMap, selectedGuid, loaded]);

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
      <span className="n-name">{semanticName(block)}</span>
      <div className="fader-row semantic">
        <span className="sem-label">弱</span>
        <GainSlider
          min={-6}
          max={6}
          value={block.bands[0]?.gain_db ?? 0}
          onValueChange={(v) => patchBand(idx, 0, { gain_db: v })}
        />
        <span className="sem-label">强</span>
      </div>
    </div>
  );

  const curveD = useMemo(
    () => freqPath(blocks, selected?.sample_rate ?? 48000, curveW),
    [blocks, selected?.sample_rate, curveW],
  );

  const peakGain = useMemo(() => {
    let m = 0;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) m = Math.max(m, band.gain_db);
    }
    return m;
  }, [blocks]);

  const totalBands = useMemo(() => blocks.reduce((n, b) => n + b.bands.length, 0), [blocks]);

  const xGrid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => logX(f, curveW));
  const xLabels = ["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"];
  const yGrid = [6, 4, 2, 0, -2, -4, -6, -8, -10, -12, -14, -16].map((db) => ({ db, y: dbY(db) }));
  const plotTop = dbY(6);
  const plotBottom = dbY(-16);

  const deviceTuningOn = (guid: string) => tuningMap[guid] ?? true;
  const toggleDeviceTuning = (guid: string) => {
    const next = !deviceTuningOn(guid);
    dirtyRef.current = true;
    setTuningMap((prev) => ({ ...prev, [guid]: next }));
  };

  const minimizeWindow = () => {
    try { void getCurrentWindow().minimize(); } catch { /* web fallback */ }
  };
  const toggleMaximizeWindow = async () => {
    try {
      const w = getCurrentWindow();
      await w.toggleMaximize();
      setIsMax(await w.isMaximized());
    } catch { /* web fallback */ }
  };
  const closeWindow = () => {
    try { void getCurrentWindow().close(); } catch { /* web fallback */ }
  };

  const switchView = (v: ViewMode) => {
    setSegDir(v === "advanced" ? "right" : "left");
    setView(v);
  };

  useEffect(() => {
    let dispose: (() => void) | undefined;
    const init = async () => {
      try {
        const w = getCurrentWindow();
        setIsMax(await w.isMaximized());
        const unlisten = await w.onResized(() => {
          void w.isMaximized().then(setIsMax);
        });
        dispose = unlisten;
      } catch { /* web fallback */ }
    };
    void init();
    return () => dispose?.();
  }, []);

  return (
    <div className="app-shell-new">
      <div className="topbar" data-tauri-drag-region>
        <img className="logo" src={logoUrl} alt="VxAPO" draggable={false} />
        <button className="pill" type="button" onClick={() => setSettingsOpen(true)}>设置</button>
        <button className="pill" type="button">导入</button>
        <button className="pill" type="button">导出</button>
        <span className="spacer" data-tauri-drag-region />
        <div className="seg view-seg" data-dir={segDir} role="radiogroup" aria-label="视图切换">
          <span className={`seg-thumb ${view === "advanced" ? "right" : ""}`} />
          <button type="button" disabled={channelOn} aria-pressed={view === "preset"} onClick={() => switchView("preset")}>
            <Tags size={13} />
            语义视图
          </button>
          <button type="button" aria-pressed={view === "advanced"} onClick={() => switchView("advanced")}>
            <SlidersHorizontal size={13} />
            参数视图
          </button>
        </div>
        <span className="spacer" data-tauri-drag-region />
        <button className="pill winbtn" type="button" aria-label="最小化" onClick={minimizeWindow}>
          <Minus size={16} />
        </button>
        <button className="pill winbtn" type="button" aria-label={isMax ? "还原" : "最大化"} onClick={() => void toggleMaximizeWindow()}>
          {isMax ? <Copy size={14} /> : <Square size={13} />}
        </button>
        <button className="pill winbtn close" type="button" aria-label="关闭" onClick={closeWindow}>
          <X size={16} />
        </button>
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
              <div className="adv-cat">滤波器</div>
              <button className="adv-pill" type="button" onClick={addBand}>
                <Plus size={14} className="adv-plus" />
                <span>峰值滤波器</span>
              </button>
              <button className="adv-pill disabled" type="button" disabled>
                <Plus size={14} className="adv-plus" />
                <span>高架滤波器</span>
              </button>
              <button className="adv-pill disabled" type="button" disabled>
                <Plus size={14} className="adv-plus" />
                <span>低架滤波器</span>
              </button>
              <button className="adv-pill disabled" type="button" disabled>
                <Plus size={14} className="adv-plus" />
                <span>低通滤波器</span>
              </button>
              <button className="adv-pill disabled" type="button" disabled>
                <Plus size={14} className="adv-plus" />
                <span>高通滤波器</span>
              </button>
              <div className="adv-cat">效果器</div>
              {["Wide", "Aural", "Reverb", "Maximizer", "Loudness"].map((name) => (
                <button className="adv-pill disabled" type="button" disabled key={name}>
                  <Plus size={14} className="adv-plus" />
                  <span>{name}</span>
                </button>
              ))}
              <div className="adv-cat">通道</div>
              <button
                className={`adv-pill ${channelOn ? "active" : ""}`}
                type="button"
                onClick={() => {
                  dirtyRef.current = true;
                  setChannelOn((v) => !v);
                }}
              >
                <Plus size={14} className="adv-plus" />
                <span>通道选择器</span>
              </button>
            </div>
          )}

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
                          <span className="g-name">{semanticName(item.block)}</span>
                          <span className="grow" />
                        </div>
                        <div className="fader-row semantic">
                          <span className="sem-label">弱</span>
                          <GainSlider
                            min={-6}
                            max={6}
                            value={item.block.bands[0]?.gain_db ?? 0}
                            onValueChange={(v) => patchBand(item.idx, 0, { gain_db: v })}
                          />
                          <span className="sem-label">强</span>
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
                          <VxSwitch checked={b.enabled} onCheckedChange={(v) => patchBlock(bi, { enabled: v })} />
                        </div>
                        <div className="fcq-row">
                          <div className="fcq-cell">
                            <span className="field-label">Fc</span>
                            <input type="number" className="num" value={band.fc} onChange={(e) => patchBand(bi, 0, { fc: Number(e.target.value) })} />
                          </div>
                          <div className="fcq-cell">
                            <span className="field-label">Q</span>
                            <input type="number" step={0.01} className="num" value={band.q} onChange={(e) => patchBand(bi, 0, { q: Number(e.target.value) })} />
                          </div>
                        </div>
                        <div className="gain-cell">
                          <span className="field-label">Gain</span>
                          <div className="gain-line">
                            <GainSlider min={-30} max={30} value={band.gain_db} onValueChange={(v) => patchBand(bi, 0, { gain_db: v })} />
                            <input
                              type="number"
                              className="gain-input"
                              min={-30}
                              max={30}
                              step={0.1}
                              value={band.gain_db}
                              aria-label="Gain 数值"
                              onChange={(e) => patchBand(bi, 0, { gain_db: Number(e.target.value) })}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="bottom-row">
              <div className="dev-props-card">
                <div className="dev-props-title">设备属性</div>
                <div className="dev-prop"><span>设备名</span><b className="dev-name">{selected?.name ?? "—"}</b></div>
                <div className="dev-prop"><span>类型</span><b>{selected?.kind === "capture" ? "捕获设备" : selected?.kind === "playback" ? "播放设备" : "—"}</b></div>
                <div className="dev-prop"><span>通道数</span><b>{selected?.channels ?? "—"}</b></div>
                <div className="dev-prop"><span>采样率</span><b>{selected?.sample_rate != null ? `${selected.sample_rate} Hz` : "—"}</b></div>
                <div className="dev-prop"><span>位深</span><b>{selected?.bit_depth != null ? `${selected.bit_depth} bit` : "—"}</b></div>
                <div className="dev-prop"><span>音量</span><b>{selected?.volume != null ? `${Math.round(selected.volume * 100)}%` : "—"}</b></div>
                <div className="dev-prop"><span>峰值增益</span><b>{peakGain > 0 ? "+" : ""}{peakGain.toFixed(1)} dB</b></div>
                <div className="dev-prop"><span>段数</span><b>{totalBands}</b></div>
              </div>
              <div className="curve-wrap" ref={curveRef}>
                <div className="curve-head">
                  <span className="t">频响曲线</span>
                  <VxSelect
                    value={curveChannel}
                    options={[
                      { value: "左声道", label: "左声道" },
                      { value: "右声道", label: "右声道" },
                    ]}
                    onValueChange={setCurveChannel}
                    ariaLabel="声道"
                  />
                </div>
                <svg viewBox={`0 0 ${curveW} 220`} width="100%" height="220" preserveAspectRatio="none" role="img" aria-label="频响曲线">
                  {yGrid.map(({ db, y }) => (
                    <line key={`y${db}`} x1="40" y1={y} x2={curveW - 40} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
                  ))}
                  {xGrid.map((x, i) => (
                    <line key={`x${i}`} x1={x} y1={plotTop} x2={x} y2={plotBottom} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
                  ))}
                  <line x1="40" y1={plotTop} x2="40" y2={plotBottom} stroke="var(--border-strong)" strokeWidth="1.5" />
                  <line x1="40" y1={plotBottom} x2={curveW - 40} y2={plotBottom} stroke="var(--border-strong)" strokeWidth="1.5" />
                  <path
                    d={curveD}
                    fill="none"
                    stroke="var(--brand-deep)"
                    strokeWidth="2"
                  />
                  <g fill="var(--text-secondary)" fontSize="10">
                    {xLabels.map((f, i) => (
                      <text key={f} x={xGrid[i]} y={plotBottom + 12} textAnchor="middle">{f}</text>
                    ))}
                    {yGrid.map(({ db, y }) => (
                      <text key={`l${db}`} x="34" y={y + 3} textAnchor="end">{db >= 0 ? `+${db}` : `${db}`}</text>
                    ))}
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </main>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={setTheme}
      />
    </div>
  );
}

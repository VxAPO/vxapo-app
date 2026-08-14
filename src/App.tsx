import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import "./new.css";
import { listDevices, readConfig, uninstallDevice, writeConfig } from "./lib/api";
import type { Block, Device, PresetLibraryEntry, SideSection, ViewMode } from "./lib/model";
import { buildToml, parseConfigWithTail } from "./lib/toml";
import logoUrl from "./assets/VxAPO_icon_v4.svg";
import { Copy, Minus, Plus, SlidersHorizontal, Square, Tags, X } from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";
import { motion } from "framer-motion";
import GainSlider from "./components/GainSlider";
import CurvePlot, { peakingDb } from "./components/CurvePlot";
import SettingsDialog from "./components/SettingsDialog";
import UninstallDialog from "./components/UninstallDialog";
import VxSelect from "./components/VxSelect";
import DragCard from "./components/DragCard";

const LIBRARY: PresetLibraryEntry[] = [
  {
    id: "fps",
    group: "FPS 预设",
    name: "脚步 · 枪声增强",
    desc: "突出脚步与枪声辨识，听声辨位更清楚",
    bands: [
      { fc: 250, gain_db: 4, q: 1.2, name: "脚步声增强" },
      { fc: 3200, gain_db: 3, q: 2, name: "枪声增强" },
    ],
  },
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

function nextGroupName(base: string, groups: Set<string>): string {
  if (!groups.has(base)) return base;
  let n = 2;
  while (groups.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function ensureBlockIds(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.id ? b : { ...b, id: crypto.randomUUID() }));
}

function buildSemanticUnits(blocks: Block[]): { key: string; blocks: Block[] }[] {
  const units: { key: string; blocks: Block[] }[] = [];
  const emitted = new Set<string>();
  blocks.forEach((b) => {
    if (!b.group) {
      units.push({ key: `s-${b.id}`, blocks: [b] });
      return;
    }
    if (emitted.has(b.group)) return;
    emitted.add(b.group);
    units.push({ key: `g-${b.group}`, blocks: blocks.filter((x) => x.group === b.group) });
  });
  return units;
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
  const [uninstallTarget, setUninstallTarget] = useState<Device | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [curveW, setCurveW] = useState(640);
  const saveTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const curveRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayNum, setOverlayNum] = useState(0);
  const [, setTick] = useState(0);
  const [fly, setFly] = useState<{
    id: number;
    key: string;
    content: ReactNode;
    from: { left: number; top: number; width: number; height: number };
    to: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const flyIdRef = useRef(0);
  const dragRef = useRef<{
    key: string;
    slots: { key: string; rect: DOMRect }[];
    base: Map<string, number>;
    virtual: Map<string, number>;
    entered: number;
    html?: string;
  } | null>(null);
  const entryTimerRef = useRef<number | undefined>(undefined);
  const pendingSlotRef = useRef<number | null>(null);
  const dragTokenRef = useRef(0);


  const selected = devices.find((d) => d.guid === selectedGuid) ?? null;
  const installedDevices = useMemo(() => devices.filter(isInstalled), [devices]);

  // 兜底：任何 blocks 变化后给缺失稳定 id 的块补 id（拖拽依赖稳定键）
  useEffect(() => {
    setBlocks((prev) => {
      if (prev.every((b) => b.id)) return prev;
      return ensureBlockIds(prev);
    });
  }, [blocks]);

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
          setBlocks(ensureBlockIds(parsed.blocks));
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
          setBlocks((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(parsed.blocks)) return prev;
            return ensureBlockIds(parsed.blocks);
          });
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

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2500);
  };

  const applyPreset = (p: PresetLibraryEntry) => {
    if (totalBands + p.bands.length > 31) {
      showNotice(`最多 31 段，当前 ${totalBands} 段，添加 ${p.bands.length} 段将超限`);
      return;
    }
    dirtyRef.current = true;
    setBlocks((prev) => {
      const groups = new Set(prev.map((b) => b.group).filter((g): g is string => !!g));
      const group = nextGroupName(p.group, groups);
      return [
        ...prev,
        ...p.bands.map((b) => ({
          id: crypto.randomUUID(),
          group,
          name: b.name ?? p.name,
          enabled: true,
          bands: [{ fc: b.fc, gain_db: b.gain_db, q: b.q }],
        })),
      ];
    });
  };

  const addBand = () => {
    if (totalBands >= 31) {
      showNotice("最多 31 段，已达到上限");
      return;
    }
    dirtyRef.current = true;
    setBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), enabled: true, bands: [{ fc: 1000, gain_db: 0, q: 1 }] },
    ]);
  };

  const removeBlock = (idx: number) => {
    dirtyRef.current = true;
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeGroup = (label: string) => {
    dirtyRef.current = true;
    setBlocks((prev) => prev.filter((b) => b.group !== label));
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

  const sortItems = useMemo(
    () =>
      renderOrder.map((item) =>
        item.kind === "standalone"
          ? {
              key: `s-${item.block.id ?? item.idx}`,
              kind: "standalone" as const,
              block: item.block,
              idx: item.idx,
            }
          : { key: `g-${item.g.label}`, kind: "group" as const, g: item.g, ord: item.ord },
      ),
    [renderOrder],
  );

  const renderBandCard = (block: Block, idx: number, ord?: string) => (
    <div className="name-card" key={idx}>
      <div className="n-head">
        {ord && <span className="ord sm">{ord}</span>}
        <span className="n-name">{semanticName(block)}</span>
        <input
          type="number"
          className="num fc-num"
          value={block.bands[0]?.fc ?? 1000}
          aria-label="频率"
          onChange={(e) => patchBand(idx, 0, { fc: Number(e.target.value) })}
        />
      </div>
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

  type SortItem = (typeof sortItems)[number];

  const renderSemanticContent = (item: SortItem, num?: number) => {
    if (item.kind === "standalone") {
      const dragNum = dragRef.current ? dragRef.current.virtual.get(item.key) ?? null : null;
      return (
        <>
          <button className="close-x" type="button" aria-label="删除" onClick={() => removeBlock(item.idx)}>
            <X size={12} strokeWidth={2.5} />
          </button>
          <div className="group-head">
            <span className="ord">
              {String(num ?? (dragNum != null ? dragNum + 1 : item.idx + 1)).padStart(2, "0")}
            </span>
            <span className="g-name">{semanticName(item.block)}</span>
            <span className="grow" />
            <input
              type="number"
              className="num fc-num"
              value={item.block.bands[0]?.fc ?? 1000}
              aria-label="频率"
              onChange={(e) => patchBand(item.idx, 0, { fc: Number(e.target.value) })}
            />
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
        </>
      );
    }
    const dragNum = dragRef.current ? dragRef.current.virtual.get(item.key) ?? null : null;
    const start = num ?? (dragNum != null ? dragNum + 1 : item.g.items[0].idx + 1);
    const end =
      num != null
        ? num + item.g.items.length - 1
        : dragNum != null
          ? dragNum + item.g.items.length
          : item.g.items[item.g.items.length - 1].idx + 1;
    return (
      <>
        <button
          className="close-x"
          type="button"
          aria-label="删除整组"
          onClick={() => removeGroup(item.g.label)}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
        <div className="group-head">
          <span className="ord">
            {String(start).padStart(2, "0")}
            {end > start ? ` & ${String(end).padStart(2, "0")}` : ""}
          </span>
          <span className="g-name">{item.g.label}</span>
          <span className="grow" />
        </div>
        <div
          className="name-cards"
          style={{ gridTemplateColumns: `repeat(${item.g.items.length}, minmax(0, 1fr))` }}
        >
          {item.g.items.map(({ block, idx }) => renderBandCard(block, idx))}
        </div>
      </>
    );
  };

  const renderBandContent = (b: Block, bi: number, num?: number) => {
    const band = b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 };
    const dragNum = dragRef.current && b.id ? dragRef.current.virtual.get(b.id) ?? null : null;
    return (
      <>
        <button className="close-x" type="button" aria-label="删除" onClick={() => removeBlock(bi)}>
          <X size={12} strokeWidth={2.5} />
        </button>
        <div className="b-head">
          <button
            className={`enable-dot ${b.enabled ? "on" : ""}`}
            type="button"
            aria-pressed={b.enabled}
            aria-label={b.enabled ? "停用该段" : "启用该段"}
            title={b.enabled ? "点击停用该段" : "点击启用该段"}
            onClick={() => patchBlock(bi, { enabled: !b.enabled })}
          >
            {String(num ?? (dragNum != null ? dragNum + 1 : bi + 1)).padStart(2, "0")}
          </button>
          <span className="b-type">PEAK</span>
          <span className="grow" />
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
            <GainSlider
              min={-30}
              max={30}
              value={band.gain_db}
              disabled={!b.enabled}
              onValueChange={(v) => patchBand(bi, 0, { gain_db: v })}
            />
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
      </>
    );
  };

  const peakGain = useMemo(() => {
    let m = 0;
    const fs = selected?.sample_rate ?? 48000;
    for (let i = 0; i <= 480; i++) {
      const f = 20 * Math.pow(1000, i / 480);
      let db = 0;
      for (const b of blocks) {
        if (!b.enabled) continue;
        for (const band of b.bands) db += peakingDb(f, band.fc, band.gain_db, band.q, fs);
      }
      if (db > m) m = db;
    }
    return m;
  }, [blocks, selected?.sample_rate]);

  const yTop = Math.max(6, Math.min(30, Math.ceil((peakGain + 1) / 2) * 2));

  const totalBands = useMemo(() => blocks.reduce((n, b) => n + b.bands.length, 0), [blocks]);

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

  const cancelDrag = () => {
    window.clearTimeout(entryTimerRef.current);
    pendingSlotRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    dragRef.current = null;
    setActiveKey(null);
    setDragSize(null);
    setFly(null);
    document.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "none";
    });
    setTick((t) => t + 1);
  };

  const switchView = (v: ViewMode) => {
    cancelDrag();
    setSegDir(v === "advanced" ? "right" : "left");
    setView(v);
  };

  const confirmUninstall = async () => {
    if (!uninstallTarget) return;
    setUninstalling(true);
    try {
      await uninstallDevice(uninstallTarget.guid);
      setUninstallTarget(null);
    } catch (e: unknown) {
      setLoadErr(friendlyError(e));
    } finally {
      setUninstalling(false);
    }
  };

  const overlayContentForKey = (key: string, num: number): ReactNode => {
    const item = sortItems.find((x) => x.key === key);
    if (item) return renderSemanticContent(item, num);
    const bi = blocks.findIndex((b) => b.id === key);
    const b = bi >= 0 ? blocks[bi] : undefined;
    return b ? renderBandContent(b, bi, num) : null;
  };

  const overlayClassForKey = (key: string): string => {
    const item = sortItems.find((x) => x.key === key);
    if (item) return item.kind === "standalone" ? "group-card standalone" : "group-card";
    const b = blocks.find((x) => x.id === key);
    return b ? `band-card${b.enabled ? " enabled" : " disabled"}` : "group-card";
  };

  const renderOverlay = (key: string, num: number): ReactNode => {
    const content = overlayContentForKey(key, num);
    if (content == null) {
      const html = dragRef.current?.html;
      if (html) return <div dangerouslySetInnerHTML={{ __html: html }} />;
      return null;
    }
    return (
      <>
        <div className="drag-bar">
          <span className="drag-bar-line" />
        </div>
        {content}
      </>
    );
  };

  const positionOverlay = (x: number, y: number) => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.left = `${x - el.offsetWidth / 2}px`;
    el.style.top = `${y - el.offsetHeight / 2}px`;
  };

  const startDrag = (key: string, x: number, y: number) => {
    dragTokenRef.current += 1;
    window.clearTimeout(entryTimerRef.current);
    pendingSlotRef.current = null;
    setFly(null);
    document.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "none";
    });
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-dnd-id]"));
    const slots = els.map((el) => ({ key: el.dataset.dndId!, rect: el.getBoundingClientRect() }));
    const order = slots.map((s) => s.key);
    const base = new Map(order.map((k, i) => [k, i]));
    const origin = slots.find((s) => s.key === key);
    if (!origin) return;
    const originEl = document.querySelector<HTMLElement>(`[data-dnd-id="${key}"]`);
    dragRef.current = {
      key,
      slots,
      base,
      virtual: new Map(base),
      entered: base.get(key)!,
      html: originEl?.innerHTML,
    };
    setActiveKey(key);
    setOverlayNum(base.get(key)! + 1);
    setDragSize({ width: origin.rect.width, height: origin.rect.height });
    requestAnimationFrame(() => positionOverlay(x, y));
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    positionOverlay(e.clientX, e.clientY);
    const idx = d.slots.findIndex(
      (s) =>
        s.rect.left <= e.clientX &&
        e.clientX <= s.rect.right &&
        s.rect.top <= e.clientY &&
        e.clientY <= s.rect.bottom,
    );
    if (idx === d.entered) return;
    if (pendingSlotRef.current === idx) return; // 消抖计时中
    window.clearTimeout(entryTimerRef.current);
    pendingSlotRef.current = idx;
    entryTimerRef.current = window.setTimeout(() => {
      pendingSlotRef.current = null;
      applyLayout(idx);
    }, 180);
  };

  const applyLayout = (idx: number) => {
    const d = dragRef.current;
    if (!d) return;
    d.entered = idx;
    setOverlayNum(idx >= 0 ? idx + 1 : d.slots.length);
    const order = [...d.virtual.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const others = order.filter((k) => k !== d.key);
    let target: Map<string, number>;
    let ghostSlot: number;
    if (idx < 0) {
      // 补位：不在槽位上，其他卡压回 01，幽灵占最后槽位
      target = new Map(others.map((k, i) => [k, i]));
      ghostSlot = d.slots.length - 1;
    } else {
      // 避让：被拖卡占 idx，其余卡一起让位
      others.splice(Math.min(idx, others.length), 0, d.key);
      target = new Map(others.map((k, i) => [k, i]));
      ghostSlot = idx;
    }
    const duration = idx < 0 ? 200 : 280;
    const trans = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    for (const [k, v] of d.virtual) {
      if (k === d.key) continue;
      const t = target.get(k);
      if (t == null || t === v) continue;
      const baseIdx = d.base.get(k);
      if (baseIdx == null) continue;
      const baseRect = d.slots[baseIdx].rect;
      const toRect = d.slots[t].rect;
      const el = document.querySelector<HTMLElement>(`[data-dnd-id="${k}"]`);
      if (el) {
        el.style.transition = trans;
        el.style.transform = `translate(${toRect.left - baseRect.left}px, ${toRect.top - baseRect.top}px)`;
      }
    }
    const ghost = document.querySelector<HTMLElement>(".drag-ghost");
    const ghostBase = d.base.get(d.key);
    if (ghost && ghostBase != null) {
      const baseRect = d.slots[ghostBase].rect;
      const toRect = d.slots[ghostSlot].rect;
      ghost.style.transition = trans;
      ghost.style.transform = `translate(${toRect.left - baseRect.left}px, ${toRect.top - baseRect.top}px)`;
    }
    d.virtual = target;
    setTick((t) => t + 1);
  };

  const commitDragOrder = (d: NonNullable<typeof dragRef.current>, target: number) => {
    dirtyRef.current = true;
    const key = d.key;
    if (key.startsWith("s-") || key.startsWith("g-")) {
      setBlocks((prev) => {
        const units = buildSemanticUnits(prev);
        const oi = units.findIndex((u) => u.key === key);
        if (oi < 0 || oi === target) return prev;
        return arrayMove(units, oi, target).flatMap((u) => u.blocks);
      });
    } else {
      setBlocks((prev) => {
        const oi = prev.findIndex((b) => b.id === key);
        if (oi < 0 || oi === target) return prev;
        return arrayMove(prev, oi, target);
      });
    }
  };

  const finalizeDrop = (
    d: NonNullable<typeof dragRef.current>,
    from: DOMRect | undefined,
    content: ReactNode,
  ) => {
    const finalSlot = d.entered >= 0 ? d.entered : d.base.get(d.key)!;
    commitDragOrder(d, finalSlot);
    document.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "none";
    });
    setTick((t) => t + 1);
    if (from) {
      const box = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
      const ghostEl = document.querySelector<HTMLElement>(".drag-ghost");
      const to = ghostEl?.getBoundingClientRect() ?? d.slots[finalSlot].rect;
      setActiveKey(null);
      setDragSize(null);
      dragRef.current = null;
      setFly({
        id: ++flyIdRef.current,
        key: d.key,
        content,
        from: box(from),
        to: box(to),
      });
      return;
    }
    setActiveKey(null);
    setDragSize(null);
    dragRef.current = null;
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    window.clearTimeout(entryTimerRef.current);
    pendingSlotRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    if (!d) return;
    const from = overlayRef.current?.getBoundingClientRect();
    const num = d.entered >= 0 ? d.entered + 1 : d.slots.length;
    const content = renderOverlay(d.key, num);
    finalizeDrop(d, from, content);
  };

  const activeContent = activeKey ? renderOverlay(activeKey, overlayNum) : null;

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
                    <button
                      className="tab-close"
                      type="button"
                      aria-label={`卸载 ${d.name}`}
                      onClick={() => setUninstallTarget(d)}
                    >
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                </Fragment>
              ))}
            </div>
            <button className="tab-add" type="button" aria-label="新设备安装">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" />
              </svg>
            </button>
          </div>

          <div className="device-body">
            {loadErr && <div className="hint-row show err">{loadErr}</div>}
            {!loadErr && view === "preset" && (
              <>
                {blocks.length === 0 && <div className="hint-row show">从预设栏添加调音</div>}
                  <div className="cards device-cards">
                    {sortItems.map((item, i) => (
                      <Fragment key={item.key}>
                        <DragCard
                          id={item.key}
                          className={item.kind === "standalone" ? "group-card standalone" : "group-card"}
                          style={item.kind === "group" ? { gridColumn: `span ${item.g.items.length}` } : undefined}
                          hidden={activeKey === item.key || fly?.key === item.key}
                          onDragStart={startDrag}
                        >
                          {renderSemanticContent(item)}
                        </DragCard>
                        {activeKey === item.key && dragSize && (
                          <div
                            className="drag-ghost"
                            style={{
                              gridColumn:
                                item.kind === "group"
                                  ? `${i + 1} / span ${item.g.items.length}`
                                  : undefined,
                              gridColumnStart: item.kind === "standalone" ? i + 1 : undefined,
                              minHeight: dragSize.height,
                            }}
                          />
                        )}
                      </Fragment>
                    ))}
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
                    {blocks.map((b, bi) => (
                      <Fragment key={b.id ?? bi}>
                        <DragCard
                          id={b.id ?? String(bi)}
                          className={`band-card${b.enabled ? " enabled" : " disabled"}`}
                          hidden={activeKey === (b.id ?? String(bi)) || fly?.key === (b.id ?? String(bi))}
                          onDragStart={startDrag}
                        >
                          {renderBandContent(b, bi)}
                        </DragCard>
                        {activeKey === (b.id ?? String(bi)) && dragSize && (
                          <div
                            className="drag-ghost"
                            style={{ gridColumnStart: bi + 1, minHeight: dragSize.height }}
                          />
                        )}
                      </Fragment>
                    ))}
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
                <CurvePlot
                  blocks={blocks}
                  fs={selected?.sample_rate ?? 48000}
                  curveW={curveW}
                  yTop={yTop}
                />
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
      <UninstallDialog
        device={uninstallTarget}
        open={uninstallTarget !== null}
        busy={uninstalling}
        onOpenChange={(open) => {
          if (!open) setUninstallTarget(null);
        }}
        onConfirm={() => void confirmUninstall()}
      />
      {activeKey && (
        <div
          ref={overlayRef}
          className={`drag-fly overlay-fixed ${overlayClassForKey(activeKey)}`}
          style={dragSize ? { width: dragSize.width, height: dragSize.height } : undefined}
        >
          {activeContent}
        </div>
      )}
      {fly && (
        <motion.div
          className={`drag-fly fly-anim ${overlayClassForKey(fly.key)}`}
          initial={{
            left: fly.from.left,
            top: fly.from.top,
            width: fly.from.width,
            height: fly.from.height,
            opacity: 1,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.18)",
          }}
          animate={{
            left: fly.to.left,
            top: fly.to.top,
            width: fly.to.width,
            height: fly.to.height,
            opacity: 1,
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
          }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={() =>
            setFly((prev) => (prev && prev.id === fly.id ? null : prev))
          }
        >
          {fly.content}
        </motion.div>
      )}
      {notice && (
        <div className="vx-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

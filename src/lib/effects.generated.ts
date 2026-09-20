// 由 `npm run sync:driver-schema` 生成，请勿手改。
//
// 单一来源：vxapo-driver 的 `pipeline/dsp/specs.rs`（`effect_param_specs()`），
// 经 cli `effects schema --json` 透传。driver 改参数后重跑本脚本，生成物入库。
//
// 这里给的是 driver 的**权威数值**（范围/步进/精确默认值），不含 UI 显示精度：
// 输入框显示与「新增效果器的起点」由 effects.ts 自行取舍（见 UI_DEFAULT_PARAMS）。

/** 单个参数的可调范围、步进、driver 默认值与单位。 */
export type EffectParamSpec = {
  key: string;
  step: number;
  min: number;
  max: number;
  default: number;
  unit?: string;
};

/** 一种效果器及其全部 UI 可调参数（顺序即 UI 展示顺序）。 */
export type EffectSpec = { effect: string; params: EffectParamSpec[] };

export const EFFECT_PARAM_SPECS: EffectSpec[] = [
  {
    "effect": "preamp",
    "params": [
      {
        "key": "gain_db",
        "step": 0.1,
        "min": -120,
        "max": 48,
        "default": 0,
        "unit": "dB"
      }
    ]
  },
  {
    "effect": "wide",
    "params": [
      {
        "key": "gain",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0
      },
      {
        "key": "air",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.354331
      },
      {
        "key": "air_side",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0
      },
      {
        "key": "mix",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.6
      },
      {
        "key": "crossover_hz",
        "step": 10,
        "min": 200,
        "max": 1000,
        "default": 200,
        "unit": "Hz"
      }
    ]
  },
  {
    "effect": "aural",
    "params": [
      {
        "key": "tune_hz",
        "step": 10,
        "min": 500,
        "max": 10000,
        "default": 1760,
        "unit": "Hz"
      },
      {
        "key": "drive",
        "step": 0.01,
        "min": 0,
        "max": 4.25,
        "default": 1.76993
      },
      {
        "key": "odd",
        "step": 0.01,
        "min": 0,
        "max": 1.5,
        "default": 1.5
      },
      {
        "key": "even",
        "step": 0.01,
        "min": 0,
        "max": 0.75,
        "default": 0.25
      },
      {
        "key": "wet",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.5
      },
      {
        "key": "dry",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.5
      }
    ]
  },
  {
    "effect": "reverb",
    "params": [
      {
        "key": "room_size",
        "step": 0.01,
        "min": 0.5,
        "max": 1.5,
        "default": 1
      },
      {
        "key": "decay",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.41
      },
      {
        "key": "damping",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.40829
      },
      {
        "key": "pre_delay_ms",
        "step": 1,
        "min": 0,
        "max": 100,
        "default": 0,
        "unit": "ms"
      },
      {
        "key": "low_cut_hz",
        "step": 5,
        "min": 20,
        "max": 250,
        "default": 100,
        "unit": "Hz"
      },
      {
        "key": "wet",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.27
      },
      {
        "key": "dry",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0.73
      }
    ]
  },
  {
    "effect": "compressor",
    "params": [
      {
        "key": "threshold_db",
        "step": 1,
        "min": -60,
        "max": 0,
        "default": -18,
        "unit": "dBFS"
      },
      {
        "key": "ratio",
        "step": 0.5,
        "min": 1,
        "max": 20,
        "default": 4
      },
      {
        "key": "knee_db",
        "step": 1,
        "min": 0,
        "max": 12,
        "default": 3,
        "unit": "dB"
      },
      {
        "key": "attack_ms",
        "step": 0.5,
        "min": 0.1,
        "max": 100,
        "default": 10,
        "unit": "ms"
      },
      {
        "key": "release_ms",
        "step": 10,
        "min": 10,
        "max": 1000,
        "default": 100,
        "unit": "ms"
      },
      {
        "key": "makeup_gain_db",
        "step": 0.5,
        "min": 0,
        "max": 24,
        "default": 6,
        "unit": "dB"
      },
      {
        "key": "wet",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 1
      },
      {
        "key": "dry",
        "step": 0.01,
        "min": 0,
        "max": 1,
        "default": 0
      }
    ]
  },
  {
    "effect": "loudness",
    "params": [
      {
        "key": "phon",
        "step": 1,
        "min": 0,
        "max": 120,
        "default": 80,
        "unit": "phon"
      },
      {
        "key": "reference_phon",
        "step": 1,
        "min": 0,
        "max": 120,
        "default": 80,
        "unit": "phon"
      }
    ]
  }
];

// 物理与球桌规格常量（单位：米、秒、弧度）。
// 取值参照世界台球规则的 9 尺球台与 57.15mm 球，摩擦/弹性参数取文献常见值，供后续试打微调。

export const BALL_R = 0.028575; // 球半径 (2.25in 直径的一半)
export const BALL_D = BALL_R * 2;

export const TABLE = {
  L: 2.54, // 库边内沿长度
  W: 1.27, // 库边内沿宽度
  cornerMouth: 0.118, // 角袋口宽度
  sideMouth: 0.132, // 中袋口宽度
  jawLen: 0.09, // 袋口颚（斜切库边）长度
  headStringX: -2.54 / 4, // 开球线（头库 1/4 处）
  footSpotX: 2.54 / 4, // 置球点（脚库 1/4 处）
};

export const PHYS = {
  g: 9.81,
  muSlide: 0.21, // 球-台呢 滑动摩擦
  muRoll: 0.012, // 滚动阻力等效摩擦
  muSpin: 0.022, // 竖直轴旋转（塞）衰减等效摩擦
  muBall: 0.06, // 球-球摩擦（throw 效应）
  eBall: 0.945, // 球-球恢复系数
  eCushion: 0.78, // 球-库边恢复系数
  muCushion: 0.2, // 球-库边摩擦
  noseHeight: 0.0363, // 库边鼻高于台面（约球高的 63.5%）
  maxCueSpeed: 8.0, // 满力击球初速 m/s
  slideEps: 1e-3, // 判定纯滚动的接触点滑速阈值
  stopEps: 0.008, // 判定静止的速度阈值
  spinStopEps: 0.05, // 判定静止的角速度阈值
};

// 转动惯量相关：实心球 I = (2/5) m R²，以单位质量计，角速度对冲量的响应系数 = 5/(2R²)
export const INV_I = 5 / (2 * BALL_R * BALL_R);

// 击球时杆法偏移量到角速度的比例：ω = (5/2)(b/R)(v/R)
export const SPIN_GAIN = 2.5 / BALL_R;

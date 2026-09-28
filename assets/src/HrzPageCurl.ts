const { ccclass, property } = cc._decorator;

import { HrzNodeUtils } from './HrzNodeUtils';

/** 日志标签。 */
const TAG: string = 'HrzPageCurl';

/** 纵向默认分段数；斜折痕下法向坐标随 y 变化，纵向必须细分。 */
const DEFAULT_MESH_ROWS: number = 24;

/** 起手折痕角的默认值（度）；45 度表示从右下角呈对角起卷。 */
const DEFAULT_CORNER_ANGLE_DEG: number = 45;

/** 折痕转直的起始进度上限；留一点余量保证结束时一定能转到 90 度。 */
const MAX_STRAIGHTEN_START: number = 0.95;

/** 锚点起手外扩距离相对卷曲半径的比例；保证 progress 0 时被卷起的区域为空。 */
const CORNER_MARGIN_RATIO: number = 0.45;

/**
 * 收尾展平占动画末尾的比例。
 *
 * 这一段里卷曲半径从设定值平滑收到 0：卷曲展开、被卷走的弧长还给纸面，
 * 卡片因此恢复原始宽度，并平铺到原位置的左侧（右边缘贴着原左边缘）。
 * 不这样做的话，结束时筒体仍占着 curlRadius 左右的宽度，卡片会比原来窄。
 */
const LANDING_RATIO: number = 0.2;

/**
 * 弯折角转满 180° 的默认进度 = 1 − 收平阶段默认占比。
 *
 * 弯折角到 180°，折痕两侧的纸面才**互相平行**（"翻到底"的样子）；留出的尾巴
 * 正好给收平阶段，两个动作不重叠：先转到底，再收平落地。
 */
const DEFAULT_TURN_SPAN: number = 1 - LANDING_RATIO;

/** 收平阶段最少占的进度比例；保证无论 turnSpan 怎么设，都留一点余量把卡片收平。 */
const MIN_LANDING_RATIO: number = 0.05;

/** 折痕弯曲度的默认值；0 = 折痕是直线（原始行为）。 */
const DEFAULT_FOLD_CURVATURE: number = 0;

/** 折痕弯曲度的取值范围；面板与代码都按这个范围夹。 */
const MAX_FOLD_CURVATURE: number = 3;

/** 折痕（剥离线）外移量相对卷曲半径的比例上限；防止极端取值把折痕推得太远。 */
const MAX_PEEL_OFFSET_RATIO: number = 4;

/**
 * 折痕拖尾的集中度（外移量沿折痕方向的幂次）。
 *
 * 参考视频实测：折痕在页面上面约 85% 的高度里是**直线**，只有最底部约 15% 明显拖尾。
 * 幂次越大拖尾越集中：幂 2 时整条折痕都在弯（看起来像帆），幂 4 时只弯下半段。
 * 想更集中（幂 8）需要更大的 `meshRows`：24 行时网格分辨不出那么锐的转折，
 * 底部会冒出一根细长的碎面。
 */
const PEEL_TAIL_POWER: number = 4;

/** 求最大法向坐标时的采样份数；折痕可弯之后极值不一定在四角，必须采样。 */
const MAX_B_SAMPLES: number = 16;

/** 单方向最大分段数，避免误填导致顶点数爆炸。 */
const MAX_SEGMENTS: number = 256;

/** `cc.Sprite.Type.MESH` 的真实枚举值；creator.d.ts 中该枚举成员全部生成为 0。 */
const SPRITE_TYPE_MESH: number = 4;

/** `cc.Sprite.Type.SIMPLE` 的真实枚举值；截图前用它让节点自身恢复成可渲染的四边形。 */
const SPRITE_TYPE_SIMPLE: number = 0;

/**
 * 引擎网格 assembler 读取的顶点结构。
 *
 * 2.4.15 的 `creator.d.ts` 没有声明 `cc.SpriteFrame.vertices`，按引擎实现
 * `webgl/assemblers/sprite/2d/mesh.js` 补齐最小结构；数据全部由本组件生成，
 * 不来自服务端或外部数据，因此可以精确建模，不需要 any。
 *
 * 数组在构建时分配一次后原地复用，逐帧只改内容。
 */
interface IHrzPageCurlVertices {
    /** 顶点 x，单位像素，以图片左边缘为 0。 */
    x: number[];
    /** 顶点 y，单位像素，以图片顶边为 0；引擎会计算 (originalHeight - y) 完成翻转。 */
    y: number[];
    /** 纹理像素坐标 u。 */
    u: number[];
    /** 纹理像素坐标 v。 */
    v: number[];
    /** 归一化纹理坐标 u；网格 assembler 直接使用该字段。 */
    nu: number[];
    /** 归一化纹理坐标 v。 */
    nv: number[];
    /** 三角形顶点索引；拓扑固定，只填一次。 */
    triangles: number[];
}

/** 页面坐标上某一点经过卷曲映射后的结果。 */
interface IHrzPageCurlPoint {
    /** 变形后的页面横向坐标；翻过去的部分会落在页面之外（负值）。 */
    x: number;
    /** 变形后的页面纵向坐标，0 = 底边。 */
    y: number;
    /** 深度；正数表示朝观察者方向抬起。 */
    z: number;
    /** 表面法线相对初始朝向的偏转角（弧度）；小于 90 度表示正面朝向观察者。 */
    angle: number;
}

/**
 * 折痕定义：过锚点 A、方向角 φ 的直线。
 *
 * 法向 n 指向被卷起的一侧；沿折痕方向的坐标 a 在卷曲中保持不变（圆柱卷曲的性质）。
 */
interface IHrzPageCurlFold {
    /** 锚点横向坐标（页面坐标）。 */
    ax: number;
    /** 锚点纵向坐标（页面坐标）。 */
    ay: number;
    /** 折痕法向的横向分量。 */
    nx: number;
    /** 折痕法向的纵向分量。 */
    ny: number;
    /** 折痕方向的横向分量。 */
    tx: number;
    /** 折痕方向的纵向分量。 */
    ty: number;
}

/** 子节点的原始激活状态。 */
interface IHrzPageCurlChildState {
    /** 子节点。 */
    node: cc.Node;
    /** 原始激活状态。 */
    active: boolean;
}

/** 节点在翻页前的原始外观，用于播放结束后还原。 */
interface IHrzPageCurlNodeRecord {
    /** 目标节点。 */
    node: cc.Node;
    /** 目标 Sprite；节点原本没有时，播放期间会临时加一个当网格宿主。 */
    sprite: cc.Sprite;
    /** 上面那个 Sprite 是不是本次播放临时加上的；是的话还原时要移除。 */
    addedSprite: boolean;
    /** 原始图片帧；节点原本没有 Sprite 时为 null。 */
    frame: cc.SpriteFrame;
    /** 原始 Sprite 类型。 */
    type: cc.Sprite.Type;
    /** 原始尺寸模式。 */
    sizeMode: cc.Sprite.SizeMode;
    /** 原始节点颜色。 */
    color: cc.Color;
    /** 原始节点层级。 */
    zIndex: number;
    /** 原始激活状态；背面初始通常是 inactive 的。 */
    active: boolean;
    /** 原始 contentSize；节点尺寸为 0 时会用截图尺寸临时兜底。 */
    size: cc.Size;
    /** contentSize 是否被临时改写过。 */
    sizeChanged: boolean;
    /** 子节点原始激活状态；翻页期间子节点整体隐藏，它们的画面已经烘进截图纹理。 */
    childActive: IHrzPageCurlChildState[];
    /** 当前持有的截图帧；挂着 RenderTexture，需要显式释放。 */
    captured: cc.SpriteFrame;
}

/** 单层运行时数据。 */
interface IHrzPageCurlLayer {
    /** 该层节点。 */
    node: cc.Node;
    /** 该层 Sprite。 */
    sprite: cc.Sprite;
    /** 运行时构造的网格 SpriteFrame。 */
    frame: cc.SpriteFrame;
    /** 复用的顶点容器。 */
    vertices: IHrzPageCurlVertices;
    /** 该层 UV 是否水平镜像。 */
    mirrorU: boolean;
    /** 该层纹理的 v 方向是否与普通图片相反。 */
    textureFlipY: boolean;
}

/** 带网格顶点数据的 SpriteFrame 视图；vertices 未在 creator.d.ts 中声明。 */
type HrzPageCurlFrame = cc.SpriteFrame & { vertices: IHrzPageCurlVertices | null };

/** 带顶点脏标记的 Sprite 视图；_vertsDirty 未在 creator.d.ts 中声明。 */
type HrzPageCurlSprite = cc.Sprite & { _vertsDirty: boolean };

/** 带渲染脏标记的节点视图；_renderFlag 未在 creator.d.ts 中声明。 */
type HrzPageCurlNode = cc.Node & { _renderFlag: number };

/** cc.RenderFlow 未在 creator.d.ts 中声明，按运行时结构补齐最小视图。 */
interface IHrzPageCurlRenderFlow {
    /** 请求渲染流程本帧重跑 assembler.updateRenderData。 */
    FLAG_UPDATE_RENDER_DATA: number;
}

/** 需要重跑 updateRenderData 时置位的渲染标记；取不到时为 null，调用方跳过置位。 */
const HRZ_PAGE_CURL_RENDER_FLOW: IHrzPageCurlRenderFlow | null =
    (cc as unknown as { RenderFlow?: IHrzPageCurlRenderFlow }).RenderFlow || null;

/**
 * HrzPageCurl — 卷角翻页组件。
 *
 * 在编辑器里把它挂到任意节点上，用属性面板指定正面节点和背面节点即可，不需要按名字查找节点。
 * 调用 `play()` 播放一次翻页；节点上的子节点（Label、子 Sprite 等）会跟着一起翻。
 *
 * ## 折痕
 *
 * 折痕是一条**斜线**：起手 45 度贴着右下角，随进度一边旋转到竖直、一边平移到铰链，
 * 所以画面是"从右下角开始卷起"，而不是整条边一起翻。
 *
 * 折痕的方向（`cornerAngle`）和折痕的**弯曲**（`foldCurvature`）是两个互相独立的参数：
 * 前者决定"从哪个角往哪拉"，后者决定"折痕弯多少"。底边绕过卷筒时能不能卷出弧线，
 * 由弯曲度直接控制，不必再去动方向。
 *
 * ## 两层怎么分工
 *
 * 正面和背面是同一张纸的两面，共用同一套卷曲映射 `_mapVertex(...)` ——
 * 这是「一套函数、两段取值」而不是两套形变。分界点 `splitB` 由「表面法线刚好转过 90 度」
 * 在折痕法向坐标系里解出，两层在这一个点上采样到完全相同的位置，因此接缝严丝合缝。
 *
 * 网格是覆盖整页的规则二维网格，两层各用一份；每层只覆盖分界线自己那一侧，
 * 另一侧的顶点被夹到分界线上，塌陷区三角形面积为零，不会画出来。
 *
 * ## 收尾展开
 *
 * 动画末尾 `LANDING_RATIO` 那一段里，卷曲半径从设定值平滑收到 0：卷曲展开、被卷走的弧长
 * 还给纸面。于是结束态是**卡片平铺在原位置左侧 `[-pageWidth, 0]`**，宽度恢复原始值
 * （不展开的话筒体会一直占着 `curlRadius` 左右的宽度，卡片看起来比原来窄），
 * 且全程连续、没有跳变。
 *
 * ## 节点树一起翻
 *
 * 网格形变只作用于某一个渲染对象的顶点，节点上的子节点是独立渲染对象、不会跟着弯。
 * 所以默认先把节点整棵子树截图成一张纹理（用项目既有的截图能力），再卷曲这张纹理，
 * 并在翻页期间把原树隐藏起来。把 `captureSubtree` 关掉才会退回只卷曲节点自身的 Sprite。
 *
 * ## 节点需不需要自带 cc.Sprite
 *
 * **不需要。** 画面来自整棵子树的截图，网格只需要一个"渲染宿主"——一个 cc.Sprite。
 * 节点没挂 cc.Sprite 时，播放期间会临时加一个（`addedSprite`），结束后移除；
 * 节点 contentSize 是 0×0 时会临时用截图尺寸兜底（`sizeChanged`），结束后还原。
 * 节点自带 cc.Sprite 时行为不变：直接借用它，播放结束后把帧/类型/尺寸模式还原。
 *
 * ## 初始可见性
 *
 * 网格模式的 Sprite 在没有 vertices 时不会渲染，但挡不住子节点单独绘制，所以背面节点
 * 初始应该在预制体里设成 **inactive**，由本组件在播放时激活、播放结束后按记录还原。
 */
@ccclass
export default class HrzPageCurl extends cc.Component {

    /** 正面节点；子树会被整体截图后卷曲，节点自己不需要挂 cc.Sprite。 */
    @property({ type: cc.Node, tooltip: '正面节点（整棵子树会被截图后卷曲）' })
    public frontNode: cc.Node = null;

    /** 背面节点；与正面节点同尺寸、同位置，同样不需要自带 cc.Sprite。 */
    @property({ type: cc.Node, tooltip: '背面节点（与正面同尺寸同位置）' })
    public backNode: cc.Node = null;

    /** 一次翻页的时长（秒）。 */
    @property({ tooltip: '翻页时长（秒）' })
    public duration: number = 1.2;

    /** 横向分段数。 */
    @property({ tooltip: '横向分段数' })
    public segments: number = 64;

    /** 纵向分段数；斜折痕下纵向必须细分，调大更圆滑、调小更省。 */
    @property({ tooltip: '纵向分段数' })
    public meshRows: number = DEFAULT_MESH_ROWS;

    /**
     * 透视强度，0 表示关闭、1 表示最强，默认 0.5。
     *
     * 卷曲段每个顶点的深度 `z` 已经是算好的，这里按 `1/(1 - z/焦距)` 把它投到屏幕上：
     * 越靠近观察者的部分被放得越大，于是卷起来的那段会"顶出来"，纵向也跟着撑开，
     * 而不是只被横向压扁。焦距取 `页宽 / 强度`，所以强度越大透视越夸张。
     *
     * 收尾展平阶段 `z` 趋于 0，投影系数回到 1，**落点不受影响**。
     */
    @property({ range: [0, 1, 0.01], tooltip: '透视强度，0 = 关闭' })
    public perspectiveStrength: number = 0.5;

    /**
     * 透视投影中心的横向位置，0 = 卡片左边缘、0.5 = 卡片中线、1 = 右边缘，默认 0.5。
     *
     * 投影中心应当是「相机正对着的那个点」。卡片在屏幕上居中时它就等于卡片中心；
     * 如果卡片被移到画面别处，这里要跟着改，否则透视会偏。
     */
    @property({ range: [0, 1, 0.01], tooltip: '透视投影中心 X（0~1，相对卡片宽度）' })
    public perspectiveCenterX: number = 0.5;

    /** 透视投影中心的纵向位置，0 = 卡片底边、0.5 = 中线、1 = 顶边，默认 0.5。 */
    @property({ range: [0, 1, 0.01], tooltip: '透视投影中心 Y（0~1，相对卡片高度）' })
    public perspectiveCenterY: number = 0.5;

    /**
     * 起手折痕角（度），默认 45。
     *
     * 90 度 = 折痕一开始就是竖直线（整条边一起翻，没有角部起卷）；
     * 45 度 = 从右下角呈对角起卷；再小则更贴底边。
     * 不论起手多少度，收尾都会转到 90 度，页面才能正落在左侧。
     */
    @property({ range: [0, 90, 1], tooltip: '起手折痕角（度）' })
    public cornerAngle: number = DEFAULT_CORNER_ANGLE_DEG;

    /**
     * 折痕开始往竖直转的进度，默认 0（一开就转）。
     *
     * 0 = 全程线性转直；
     * 0.5 = 前半程保持起手角、后半程才转直（角部卷起的感觉更久）。
     * 上限 0.95，保证结束时一定能到 90 度，否则页面落不正。
     */
    @property({ range: [0, 1, 0.01], tooltip: '折痕开始转直的进度（0 = 一开就转）' })
    public straightenStart: number = 0;

    /**
     * 弯折角转满 180° 的进度，默认 0.8。
     *
     * 弯折角到 180° 时，折痕两侧的纸面才**互相平行**——也就是"翻到底、两个平面平行、
     * 中间只剩一个卷筒"的样子。进度再往后只有平移和收平。
     *
     * 为什么需要这个参数：弯折角原本是 `进度 × 180°`，只有 progress = 1 才到 180°，
     * 而收平恰好也在最后一段进行，于是「两侧平行」和「卷筒还在」永远不同时出现，
     * 画面里看到的是一块**还在斜着的平板**，而不是"两个平行平面 + 中间一个卷筒"，
     * 观感就是"太翘"。
     *
     * 默认 0.8 表示 80% 进度就转满 180°；小于 1 时收平阶段从这一刻开始，顺序是
     * 「先转到底 → 再收平落地」，两个动作不再互相重叠。
     */
    @property({ range: [0.3, 1, 0.01], tooltip: '弯折角转满 180° 的进度（收平从其之后开始）' })
    public turnSpan: number = DEFAULT_TURN_SPAN;

    /**
     * 折痕（剥离线）的弯曲程度，默认 0，**正值越大、折痕两端拖尾越明显**。
     *
     * `foldCurvature = 0`：折痕是直线（原行为）。
     * 大于 0：折痕朝"已翻起"的一侧外移，外移量只集中在**最底部**：
     * `offset(a) = κ · ((上端a − a) / 页宽)^4 · 卷曲半径`。
     * 于是页面大部分高度的折痕仍然是直线，只有贴近底边的一段拖尾 ——
     * 就是参考视频里那条边（实测：y≥700 处基本为直线，y=800 处滞后 +110~236px，
     * 参考页宽约 850px；换算到 701 宽约 +90px，对应 κ ≈ 1~1.5）。
     *
     * 实现上的关键：这个外移量会**同时加回平直区域的映射**
     * （`paper = A + a·t + (b + offset)·n`），所以未翻起的部分逐点都不动，
     * 页面严格刚性；静止态（弯折角为 0）更是完全等于原始位置。
     *
     */
    @property({ range: [0, MAX_FOLD_CURVATURE, 0.01], tooltip: '卷角弯曲度（越大底边的折痕和卷曲弧越明显）' })
    public foldCurvature: number = DEFAULT_FOLD_CURVATURE;

    /** 折痕处的卷曲半径（像素）；越小折痕越尖。 */
    @property({ tooltip: '折痕卷曲半径（像素）' })
    public curlRadius: number = 90;

    /**
     * 翻页**过程中**，筒体压住卡片左边缘的宽度（像素），默认 0 表示一点不压。
     *
     * 只影响过程观感：收尾阶段卷曲会展开（见 `LANDING_RATIO`），结束时筒体已经收没，
     * 卡片固定平铺到原位置左侧 `[-pageWidth, 0]`，与这个参数无关。
     *
     * 和 `curlRadius` 互不牵制：
     * - `0`：折痕推到左边缘之外，平时筒体整段落在卡片外，卡片原位完全空出来；
     * - `= curlRadius`：折痕正好落在左边缘，筒体整段压在卡片里（上限）；
     * - **负值**：折痕被推得更靠左，筒体与卡片原位之间空出一段，吃掉的宽度仍算 0。
     */
    @property({ tooltip: '筒体压住卡片左边缘的宽度（像素），0 = 不压' })
    public leftInset: number = 0;

    /** 正面 UV 是否水平镜像；正常情况不需要动。 */
    @property({ tooltip: '正面 UV 水平镜像' })
    public mirrorFront: boolean = false;

    /**
     * 背面 UV 是否水平镜像。
     *
     * 这是「为了正确而镜像」：卡片翻到另一侧后几何本身已左右翻转，只有把背面 UV 一起翻转，
     * 背面图案落平后才是正常阅读方向、不会反字。
     * 如果美术给的背面图已经按"翻开后看到的样子"预先镜像过，把它关掉。
     */
    @property({ tooltip: '背面 UV 水平镜像' })
    public mirrorBack: boolean = true;

    /** 播放结束后是否停留在翻页结束位置。 */
    @property({ tooltip: '播放结束停在翻页结束位置' })
    public keepFlipped: boolean = true;

    /** 是否先把节点整棵子树截图、再对截图做卷曲。 */
    @property({ tooltip: '先把子树截图再卷曲（子节点才会跟着翻）' })
    public captureSubtree: boolean = true;

    /** 截图像素倍率，1 表示按节点世界包围盒尺寸截图。 */
    @property({ tooltip: '截图像素倍率' })
    public captureTextureScale: number = 1;

    /**
     * 截图纹理的 v 方向是否与普通图片相反。
     *
     * RenderTexture 的上下与普通图片相反，截图组件给四边形路径挂了 setFlipY(true)；
     * 但网格 assembler 直接读 nu/nv，SpriteFrame 的 flipY 对它无效，所以要在这里自己翻。
     * 如果截图出来的卡片上下颠倒，把它关掉。
     */
    @property({ tooltip: '截图纹理 v 方向反向' })
    public captureFlipY: boolean = true;

    /** 进入场景时是否自动播放一次，方便调试。 */
    @property({ tooltip: '进入时自动播放一次' })
    public playOnLoad: boolean = false;

    /** 当前动画进度；0 到 1。 */
    private _progress: number = 0;

    /**
     * 本次刷新使用的有效卷曲半径。
     * 正常阶段等于 `curlRadius`；收尾展平阶段从它平滑收到 0。
     */
    private _currentRadius: number = 90;

    /**
     * 本次刷新使用的有效折痕弯曲度。
     * 正常阶段等于 `foldCurvature`；收平阶段跟着半径一起淡到 0，卡片才不会带着弯曲落地。
     */
    private _currentCurvature: number = 0;

    /** 本次动画已播放时间（秒）。 */
    private _elapsed: number = 0;

    /** 本次动画总时长（秒）；取一个极小值下限避免除零。 */
    private _animationDuration: number = 1;

    /** 正在播放时为 true。 */
    private _playing: boolean = false;

    /** 等待动画结束的回调；置空表示当前没有正在播放的动画。 */
    private _resolve: (() => void) | null = null;

    /** 正面节点的原始外观记录；首次播放时建立，之后跨播放复用。 */
    private _frontRecord: IHrzPageCurlNodeRecord = null;

    /** 背面节点的原始外观记录。 */
    private _backRecord: IHrzPageCurlNodeRecord = null;

    /** 正面层运行时数据；每次播放重建。 */
    private _frontLayer: IHrzPageCurlLayer = null;

    /** 背面层运行时数据。 */
    private _backLayer: IHrzPageCurlLayer = null;

    /** 进入场景时按配置自动播放。 */
    protected onLoad(): void {
        if (this.playOnLoad) {
            this.play().catch((error: Error): void => {
                console.warn(TAG, '自动播放翻页失败', error);
            });
        }
    }

    /** 组件销毁时还原节点并释放截图纹理。 */
    protected onDestroy(): void {
        this._releaseCaptured(this._frontRecord);
        this._releaseCaptured(this._backRecord);
        this._removeAddedSprite(this._frontRecord);
        this._removeAddedSprite(this._backRecord);
        this._frontRecord = null;
        this._backRecord = null;
        this._frontLayer = null;
        this._backLayer = null;
        this._finishWait();
    }

    /** 逐帧推进翻页进度。 */
    protected update(dt: number): void {
        if (!this._playing || !this._resolve) {
            return;
        }

        this._elapsed += dt;
        const linear: number = Math.min(1, this._elapsed / this._animationDuration);
        // quadInOut：起步和收尾慢、中段快，接近美术给的翻页节奏。
        this._progress = linear < 0.5
            ? 2 * linear * linear
            : 1 - Math.pow(-2 * linear + 2, 2) / 2;
        this.refresh();

        if (linear >= 1) {
            this._progress = 1;
            this.refresh();
            this._finishAnimation();
        }
    }

    /**
     * 播放一次翻页。
     *
     * 播放前记录两个节点的完整外观（含激活状态和子节点显隐），结束后按 `keepFlipped` 决定
     * 是停在结束位置还是还原。正在播放时重复调用会被忽略。
     *
     * @returns 动画结束后 resolve；参数无效或已在播放时立即 resolve
     */
    public async play(): Promise<void> {
        if (this._playing) {
            console.warn(TAG, '翻页正在播放，忽略本次调用');
            return;
        }
        if (!this.frontNode || !cc.isValid(this.frontNode) || !this.backNode || !cc.isValid(this.backNode)) {
            console.warn(TAG, '正面或背面节点未指定，无法翻页');
            return;
        }
        if (this.frontNode === this.backNode) {
            console.warn(TAG, '正面和背面是同一个节点，无法翻页', this.frontNode.name);
            return;
        }

        this._playing = true;
        this._prepareRecords();
        if (!this._frontRecord || !this._backRecord) {
            this._playing = false;
            return;
        }

        // 初始隐藏背面时节点是 inactive 的，这里统一激活，让两层都参与本次播放和截图。
        this._frontRecord.node.active = true;
        this._backRecord.node.active = true;

        // 截图阶段要等帧，而这期间节点仍会被主相机画出来。背面节点初始是隐藏的，
        // 为了截图必须先激活并切成可渲染的四边形，于是它会露出来一帧。这里先把背面压到正面层
        // 下面，让正面的卡片盖住它；两层都装好之后再恢复成"背面在上"。
        const frontZ: number = this._frontRecord.zIndex;
        const backZ: number = this._backRecord.zIndex;
        this._backRecord.node.zIndex = frontZ - 1;

        const backTexture: cc.SpriteFrame = await this._prepareTexture(this._backRecord);
        if (!cc.isValid(this)) {
            return;
        }
        const frontTexture: cc.SpriteFrame = await this._prepareTexture(this._frontRecord);
        if (!cc.isValid(this)) {
            return;
        }

        if (cc.isValid(this._frontRecord.node)) {
            this._frontRecord.node.zIndex = frontZ;
        }
        if (cc.isValid(this._backRecord.node)) {
            this._backRecord.node.zIndex = backZ;
        }

        this._frontLayer = this._attachLayer(this._frontRecord, frontTexture, this.mirrorFront);
        this._backLayer = this._attachLayer(this._backRecord, backTexture, this.mirrorBack);
        if (!this._frontLayer || !this._backLayer) {
            // 准备阶段失败时节点可能已经被切成"可渲染"状态，按记录还原，别留在半途状态。
            this._restoreNode(this._frontRecord);
            this._restoreNode(this._backRecord);
            this._playing = false;
            return;
        }

        // 背面层必须盖在正面层之上：翻过 90 度后那段位于弯曲外侧、更靠近观察者。
        this._backLayer.node.zIndex = this._frontLayer.node.zIndex + 1;

        this._animationDuration = Math.max(0.0001, this.duration);
        this._elapsed = 0;
        this._progress = 0;
        this.refresh();

        await new Promise<void>((resolve: () => void): void => {
            this._resolve = resolve;
        });

        // 默认停在翻页结束位置：保留进度 1 的网格状态。keepFlipped 关掉时还原原始外观，
        // 便于反复播放对比。
        if (!this.keepFlipped) {
            this._restoreNode(this._frontRecord);
            this._restoreNode(this._backRecord);
        }
        this._frontLayer = null;
        this._backLayer = null;
    }

    /**
     * 按当前进度重算两层顶点并提交。
     * 在编辑器或调试时也可以直接调用。
     */
    public refresh(): void {
        if (!this._frontLayer || !this._backLayer) {
            return;
        }

        const pageWidth: number = Math.max(1, this._frontLayer.node.width);
        const pageHeight: number = Math.max(1, this._frontLayer.node.height);
        const progress: number = cc.misc.clamp01(this._progress);
        const columns: number = this._resolveSegments();
        const rows: number = this._resolveRows();
        // 收尾阶段卷曲半径收到 0，卡片才能展开回原始宽度、平铺到原位左侧。
        this._currentRadius = this._resolveRadiusAt(progress);
        // 收平阶段弯曲度要一起淡出，否则卡片会带着弯曲落地。
        this._currentCurvature = this._resolveCurvatureAt(progress);

        // 折痕：起手 45 度斜线贴着右下角，随进度一边旋转到竖直、一边平移到铰链。
        const fold: IHrzPageCurlFold = this._resolveFold(progress, pageWidth);
        // 弯折总角度：0 到 180 度。turnSpan 控制它什么时候转满，转满后保持不变。
        const bendAngle: number = this._resolveBendAngle(progress);
        const maxB: number = this._resolveMaxB(fold, pageWidth, pageHeight);
        // 分界点：表面法线刚好转过 90 度的位置。
        // 正面层只覆盖 b <= 分界点，背面层只覆盖 b >= 分界点；越界顶点在 _mapVertex 里被夹到
        // 分界点上，于是两层在分界线上采样到完全相同的位置，接缝严丝合缝。
        // 分界点逐顶点按该处的有效半径算（锥形卷下每个 a 都不同），所以这里只传 side 和 maxB。
        this._writeLayer(this._frontLayer, -1, maxB, pageWidth, pageHeight, rows, columns, fold, bendAngle);
        this._writeLayer(this._backLayer, 1, maxB, pageWidth, pageHeight, rows, columns, fold, bendAngle);

        this._markDirty(this._frontLayer.sprite);
        this._markDirty(this._backLayer.sprite);
    }

    /** 结束当前等待；重复调用无副作用。 */
    private _finishWait(): void {
        const resolve: (() => void) | null = this._resolve;
        this._resolve = null;
        if (resolve) {
            resolve();
        }
    }

    /** 动画走完时收尾。 */
    private _finishAnimation(): void {
        this._playing = false;
        this._logEndState();
        this._finishWait();
    }

    /**
     * 打印结束态的折痕位置与筒体占位。
     *
     * 这几个数完全由参数决定，用来对照编辑器面板排查"左边还剩一段"这类观感问题：
     * 如果日志里"压住卡片左边缘"是 0 而画面上仍有残留，说明问题不在几何计算。
     */
    private _logEndState(): void {
        if (!this._frontLayer) {
            return;
        }

        const pageWidth: number = Math.max(1, this._frontLayer.node.width);
        const baseRadius: number = this._resolveCurlRadius();
        const endRadius: number = this._resolveRadiusAt(1);
        const fold: IHrzPageCurlFold = this._resolveFold(1, pageWidth);
        const round = (value: number): number => Math.round(value * 10) / 10;
        console.log(TAG, '翻页结束：折痕与占位', {
            curlRadius设定: round(baseRadius),
            foldCurvature设定: round(this._resolveFoldCurvature() * 100) / 100,
            结束时有效半径: round(endRadius),
            结束时弯曲度: round(this._currentCurvature * 100) / 100,
            折痕x: round(fold.ax),
            预期卡片范围: '[' + round(-pageWidth) + ', ' + round(fold.ax) + ']',
            预期宽度: round(pageWidth),
        });
    }

    /** 建立两个节点的原始外观记录；已建立时沿用旧记录。 */
    private _prepareRecords(): void {
        this._frontRecord = this._ensureRecord(this._frontRecord, this.frontNode);
        this._backRecord = this._ensureRecord(this._backRecord, this.backNode);
    }

    /**
     * 取节点对应的记录；没有就新建。
     *
     * 记录必须跨播放保留，不能每次重建：`keepFlipped` 播放过之后节点上挂的是网格帧，
     * 再拿"当前状态"当原始外观，第二次播放就会把上一轮的形变结果当成初始画面。
     *
     * @param existing 已有记录；节点未变时直接返回
     * @param node 目标节点
     * @returns 节点记录；节点缺少必要组件时返回 null
     */
    private _ensureRecord(existing: IHrzPageCurlNodeRecord, node: cc.Node): IHrzPageCurlNodeRecord {
        if (existing && cc.isValid(existing.node) && existing.node === node) {
            return existing;
        }

        const sprite: cc.Sprite = node.getComponent(cc.Sprite);
        if (!sprite) {
            // 节点不需要自己挂 Sprite：画面由"整棵子树的截图"提供，网格只需要一个渲染宿主，
            // 所以这里不报错，等装层时再临时加一个（结束时移除）。
            if (node.children.length === 0) {
                console.warn(TAG, '节点既没有 cc.Sprite 也没有子节点，截图为空', node.name);
                return null;
            }
        } else if (!sprite.spriteFrame && node.children.length === 0) {
            console.warn(TAG, 'Sprite 没有 spriteFrame，且节点没有子节点，截图为空', node.name);
            return null;
        }

        const childActive: IHrzPageCurlChildState[] = [];
        for (const child of node.children) {
            childActive.push({ node: child, active: child.active });
        }

        return {
            node: node,
            sprite: sprite,
            addedSprite: false,
            frame: sprite ? sprite.spriteFrame : null,
            type: sprite ? sprite.type : (SPRITE_TYPE_SIMPLE as cc.Sprite.Type),
            sizeMode: sprite ? sprite.sizeMode : cc.Sprite.SizeMode.CUSTOM,
            color: node.color.clone(),
            zIndex: node.zIndex,
            active: node.active,
            size: cc.size(node.width, node.height),
            sizeChanged: false,
            childActive: childActive,
            captured: null,
        };
    }

    /**
     * 截图阶段：把节点整棵子树截成一张纹理，并让节点回到可渲染的初始外观。
     *
     * 截图要求节点自身可渲染、且渲染的是"原始画面"：
     * - MESH 类型且 vertices 为空的 Sprite 什么都不画，直接截图只会截到子节点；
     * - `keepFlipped` 播放过之后，sprite 上挂的还是上一轮的网格帧。
     * 所以这里先把原始帧和普通四边形类型装回去。
     *
     * @param record 节点记录
     * @returns 供网格使用的纹理帧；截图关闭或失败时返回原始图片帧
     */
    private async _prepareTexture(record: IHrzPageCurlNodeRecord): Promise<cc.SpriteFrame> {
        if (!record || !cc.isValid(record.node)) {
            return null;
        }

        const sprite: cc.Sprite = record.sprite;
        if (sprite && cc.isValid(sprite)) {
            sprite.spriteFrame = record.frame;
            sprite.type = SPRITE_TYPE_SIMPLE as cc.Sprite.Type;
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        }

        if (!this.captureSubtree) {
            return record.frame;
        }

        // 截图渲染的是节点树本身：子节点如果是隐藏的，截出来的纹理里就没有它们。
        // 上一轮 keepFlipped 结束后子节点一直是隐藏的，这里必须先放出来。
        this._restoreChildren(record);

        // 上一次播放留下的截图纹理先释放，避免反复播放时 RenderTexture 累积。
        this._releaseCaptured(record);

        const captured: cc.SpriteFrame = await HrzNodeUtils.captureNodeToSpriteFrame(
            record.node,
            this._resolveCaptureScale(),
        );
        if (!captured) {
            console.warn(TAG, '节点子树截图失败，退回只卷曲节点自身纹理', record.node.name);
            return record.frame;
        }

        record.captured = captured;
        const size: cc.Rect = captured.getRect();
        console.log(TAG, '子树截图完成', record.node.name, cc.size(size.width, size.height));
        return captured;
    }

    /**
     * 装层阶段：把准备好的纹理做成网格 SpriteFrame 并挂到节点上。
     *
     * 网格数据必须放在一份只属于本次播放的 SpriteFrame 上：节点原有的 SpriteFrame 是共享
     * Asset，改写它的 vertices 会污染所有引用同一张图的 Sprite，资源重载后也会被还原。
     *
     * @param record 节点记录
     * @param textureFrame 供网格使用的纹理帧
     * @param mirrorU 该层是否水平镜像 UV
     * @returns 该层运行时数据；纹理无效时返回 null
     */
    private _attachLayer(
        record: IHrzPageCurlNodeRecord,
        textureFrame: cc.SpriteFrame,
        mirrorU: boolean,
    ): IHrzPageCurlLayer {
        if (!record || !cc.isValid(record.node) || !textureFrame) {
            return null;
        }

        const texture: cc.Texture2D = textureFrame.getTexture();
        if (!texture) {
            console.warn(TAG, 'SpriteFrame 纹理无效', record.node.name);
            return null;
        }

        const rect: cc.Rect = textureFrame.getRect();
        if (rect.width <= 0 || rect.height <= 0) {
            console.warn(TAG, 'SpriteFrame 矩形无效', record.node.name, rect.width, rect.height);
            return null;
        }

        // 用同一块纹理矩形另建一份网格帧；offset 取 0、originalSize 取矩形自身尺寸，
        // 让引擎网格 assembler 的 trim 换算退化为纯等比缩放，顶点像素坐标可直接映射到节点尺寸。
        const frame: cc.SpriteFrame = new cc.SpriteFrame();
        frame.setTexture(
            texture,
            cc.rect(rect.x, rect.y, rect.width, rect.height),
            false,
            cc.v2(0, 0),
            cc.size(rect.width, rect.height),
        );

        // 节点没有 Sprite 时临时加一个当网格宿主：网格数据必须挂在某个 cc.Sprite 上，
        // 而画面内容已经在截图纹理里，这个 Sprite 不需要自己的 spriteFrame。
        if (!record.sprite || !cc.isValid(record.sprite)) {
            record.sprite = record.node.addComponent(cc.Sprite);
            record.addedSprite = true;
        }

        // 页面尺寸取节点 contentSize；节点是 0×0 时用截图尺寸兜底，否则网格会渲染成 0 大小。
        if (record.node.width <= 0 || record.node.height <= 0) {
            record.node.setContentSize(rect.width, rect.height);
            record.sizeChanged = true;
        }

        record.sprite.spriteFrame = frame;
        record.sprite.type = SPRITE_TYPE_MESH as cc.Sprite.Type;
        record.sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;

        // 子节点的画面已经在截图纹理里了，必须把原树藏起来；否则它们会留在原地不动，
        // 看起来就是"卡片翻了、文字没翻"。截图失败时不能藏，否则文字直接没了。
        if (record.captured) {
            this._hideChildren(record);
        }

        // 截图纹理来自 RenderTexture，v 方向与普通图片相反。
        return {
            node: record.node,
            sprite: record.sprite,
            frame: frame,
            vertices: null,
            mirrorU: mirrorU,
            // 截图纹理来自 RenderTexture，v 方向与普通图片相反。
            textureFlipY: record.captured ? this.captureFlipY : false,
        };
    }

    /**
     * 按记录还原一个节点的外观。
     * @param record 节点记录
     */
    private _restoreNode(record: IHrzPageCurlNodeRecord): void {
        if (!record || !cc.isValid(record.node)) {
            return;
        }

        if (record.addedSprite) {
            this._removeAddedSprite(record);
        } else {
            const sprite: cc.Sprite = record.sprite;
            if (sprite && cc.isValid(sprite)) {
                sprite.spriteFrame = record.frame;
                sprite.type = record.type;
                sprite.sizeMode = record.sizeMode;
            }
        }

        if (record.sizeChanged) {
            record.node.setContentSize(record.size);
            record.sizeChanged = false;
        }

        record.node.color = record.color;
        record.node.zIndex = record.zIndex;
        this._restoreChildren(record);
        // 激活状态最后还原：背面初始是 inactive 的，先把它关回去，
        // 里面的子节点自然也就跟着不可见了。
        record.node.active = record.active;
    }

    /**
     * 移除播放期间临时加上的网格宿主 Sprite，并把被临时改写的 contentSize 还原。
     *
     * 节点自带 Sprite 时不做任何事——那种情况下节点外观由 `_restoreNode` 负责还原。
     * @param record 节点记录
     */
    private _removeAddedSprite(record: IHrzPageCurlNodeRecord): void {
        if (!record || !cc.isValid(record.node)) {
            return;
        }

        if (record.addedSprite && record.sprite && cc.isValid(record.sprite)) {
            record.node.removeComponent(record.sprite);
        }
        if (record.addedSprite) {
            record.sprite = null;
            record.addedSprite = false;
        }
        if (record.sizeChanged) {
            record.node.setContentSize(record.size);
            record.sizeChanged = false;
        }
    }

    /**
     * 隐藏记录里登记过的全部子节点。
     * @param record 节点记录
     */
    private _hideChildren(record: IHrzPageCurlNodeRecord): void {
        for (const entry of record.childActive) {
            if (cc.isValid(entry.node)) {
                entry.node.active = false;
            }
        }
    }

    /**
     * 还原子节点的激活状态。
     * @param record 节点记录
     */
    private _restoreChildren(record: IHrzPageCurlNodeRecord): void {
        for (const entry of record.childActive) {
            if (cc.isValid(entry.node)) {
                entry.node.active = entry.active;
            }
        }
    }

    /**
     * 释放记录持有的截图纹理。
     * @param record 节点记录
     */
    private _releaseCaptured(record: IHrzPageCurlNodeRecord): void {
        if (!record) {
            return;
        }
        const captured: cc.SpriteFrame = record.captured;
        record.captured = null;
        if (captured) {
            HrzNodeUtils.releaseCapturedSpriteFrame(captured);
        }
    }

    /**
     * 解析折痕最终相对卡片左边缘的外移距离。
     *
     * 由 `leftInset` 换算：筒体在结束态占据 `[左边缘 - foldOffset, 左边缘 - foldOffset + curlRadius]`，
     * 于是压住卡片的宽度恰好等于 `leftInset`，与半径无关。
     * 取值上限是 `curlRadius`：等于它时折痕正好落在左边缘、筒体整段压在卡片里，
     * 再大只会把折痕推进卡片内部、让卡片左侧一段不参与翻页，那不是一个有意义的状态。
     * **允许负值**：负得越多，折痕被推得越靠左，筒体和卡片原位之间会空出一段。
     *
     * @returns 折痕最终落在卡片左边缘之外的距离，上界为 curlRadius
     */
    private _resolveFoldOffset(): number {
        const radius: number = this._currentRadius;
        const inset: number = Number.isFinite(this.leftInset) ? this.leftInset : 0;
        return radius - Math.min(inset, radius);
    }

    /** 解析横向分段数并夹到合法范围。 */
    private _resolveSegments(): number {
        const value: number = Math.floor(Number.isFinite(this.segments) ? this.segments : 64);
        return Math.max(1, Math.min(MAX_SEGMENTS, value));
    }

    /**
     * 解析纵向分段数。
     * 斜折痕下法向坐标随纵向位置变化，只分两行会让卷曲形状失真，必须二维细分。
     * @returns 落在 [1, MAX_SEGMENTS] 内的整数行数
     */
    private _resolveRows(): number {
        const value: number = Math.floor(Number.isFinite(this.meshRows) ? this.meshRows : DEFAULT_MESH_ROWS);
        return Math.max(1, Math.min(MAX_SEGMENTS, value));
    }

    /**
     * 解析起手折痕角。
     * @returns 夹在 [0, 90] 内的起手角度
     */
    private _resolveCornerAngle(): number {
        const value: number = Number.isFinite(this.cornerAngle) ? this.cornerAngle : DEFAULT_CORNER_ANGLE_DEG;
        return Math.max(0, Math.min(90, value));
    }

    /**
     * 解析折痕开始转直的进度。
     * @returns 夹在 [0, MAX_STRAIGHTEN_START] 内的起始进度
     */
    private _resolveStraightenStart(): number {
        const value: number = Number.isFinite(this.straightenStart) ? this.straightenStart : 0;
        return Math.max(0, Math.min(MAX_STRAIGHTEN_START, value));
    }

    /**
     * 解析透视强度。
     * @returns 夹在 [0, 1] 内的透视强度；0 表示关闭
     */
    private _resolvePerspectiveStrength(): number {
        const value: number = Number.isFinite(this.perspectiveStrength) ? this.perspectiveStrength : 0;
        return Math.max(0, Math.min(1, value));
    }

    /** 解析截图像素倍率，夹到合理范围。 */
    private _resolveCaptureScale(): number {
        const value: number = Number.isFinite(this.captureTextureScale) ? this.captureTextureScale : 1;
        return Math.max(0.1, Math.min(4, value));
    }

    /**
     * 解析卷曲半径的基础值。
     * @returns 折痕处的圆弧半径，至少 1 像素
     */
    private _resolveCurlRadius(): number {
        const value: number = Number.isFinite(this.curlRadius) ? this.curlRadius : 90;
        return Math.max(1, value);
    }

    /**
     * 求指定进度下的有效卷曲半径。
     *
     * 收平阶段从「弯折角转满 180°」那一刻开始（见 `turnSpan`），半径用 smoothstep 平滑收到 0：
     * 收尾没有速度突跳，卷曲展开的同时卡片连续落平。
     *
     * @param progress 翻页进度
     * @returns 该进度下的卷曲半径，可为 0
     */
    private _resolveRadiusAt(progress: number): number {
        return this._resolveCurlRadius() * (1 - this._resolveLandingEased(progress));
    }

    /**
     * 收平阶段的进度比例，0 = 还没开始收平、1 = 完全收平。
     *
     * 收平从「弯折角转满」这一刻开始：先转到底、再收平，两个动作不重叠。
     * 半径和折痕弯曲度都按这个比例淡出，保证结束态是干净的平铺卡片。
     *
     * @param progress 翻页进度
     * @returns 0~1 的收平比例（smoothstep 缓动）
     */
    private _resolveLandingEased(progress: number): number {
        const landing: number = Math.max(MIN_LANDING_RATIO, 1 - this._resolveTurnSpan());
        const start: number = 1 - landing;
        if (progress <= start) {
            return 0;
        }

        const linear: number = Math.min(1, (progress - start) / landing);
        return linear * linear * (3 - 2 * linear);
    }

    /**
     * 解析折痕弯曲度的基础值。
     * @returns 夹在 [0, MAX_FOLD_CURVATURE] 内的弯曲度
     */
    private _resolveFoldCurvature(): number {
        const value: number = Number.isFinite(this.foldCurvature) ? this.foldCurvature : DEFAULT_FOLD_CURVATURE;
        return Math.max(0, Math.min(MAX_FOLD_CURVATURE, value));
    }

    /**
     * 求指定进度下生效的折痕弯曲度。
     * @param progress 翻页进度
     * @returns 已按收平阶段淡出的弯曲度，可为 0
     */
    private _resolveCurvatureAt(progress: number): number {
        return this._resolveFoldCurvature() * (1 - this._resolveLandingEased(progress));
    }

    /**
     * 解析弯折角转满 180° 的进度。
     * @returns 夹在 [0.3, 1] 内的进度
     */
    private _resolveTurnSpan(): number {
        const value: number = Number.isFinite(this.turnSpan) ? this.turnSpan : DEFAULT_TURN_SPAN;
        return Math.max(0.3, Math.min(1, value));
    }

    /**
     * 求指定进度下的弯折总角。
     *
     * `progress / turnSpan` 到 1 就转满 180°，之后保持不变：页面的"转"先做完，
     * 剩下的进度只负责平移和收平。
     *
     * @param progress 翻页进度
     * @returns 弯折总角（弧度），最大 π
     */
    private _resolveBendAngle(progress: number): number {
        const span: number = this._resolveTurnSpan();
        return Math.PI * Math.min(1, cc.misc.clamp01(progress) / span);
    }

    /**
     * 解析折痕：过锚点 A、方向角 φ 的直线，法向 n 指向被卷起的一侧。
     *
     * 起手折痕是 45 度斜线、贴着右下角，随进度一边旋转到 90 度（竖直）、一边平移到铰链，
     * 页面最终才能正落在左侧。锚点从页面外侧出发，progress 0 时被卷起的区域为空，
     * 因此不会出现突兀的起始态。
     *
     * @param progress 翻页进度
     * @param pageWidth 页宽
     * @returns 折痕定义
     */
    private _resolveFold(progress: number, pageWidth: number): IHrzPageCurlFold {
        const startAngle: number = this._resolveCornerAngle() * Math.PI / 180;
        // 折痕角对进度插值：straightenStart 之前保持起手角，之后线性转到 90 度。
        // straightenStart 为 0 时就是全程线性转直。
        const straightenStart: number = this._resolveStraightenStart();
        const span: number = 1 - straightenStart;
        const turnRatio: number = span <= 0 ? 1 : cc.misc.clamp01((progress - straightenStart) / span);
        const angle: number = startAngle + (Math.PI / 2 - startAngle) * turnRatio;
        const nx: number = Math.sin(angle);
        const ny: number = -Math.cos(angle);
        const tx: number = Math.cos(angle);
        const ty: number = Math.sin(angle);

        // 锚点从右下角出发沿法向反向推进。
        // 结束态折痕落在 x = -foldOffset，由 leftInset 换算而来，见 _resolveFoldOffset。
        // 起手再加一个 margin 外扩，保证 progress 0 时被卷起的区域为空。
        const margin: number = this._currentRadius * CORNER_MARGIN_RATIO;
        const foldOffset: number = this._resolveFoldOffset();
        const offset: number = margin - progress * (pageWidth + foldOffset + margin);
        return {
            ax: pageWidth + nx * offset,
            ay: ny * offset,
            nx: nx,
            ny: ny,
            tx: tx,
            ty: ty,
        };
    }

    /**
     * 求页面四角中法向坐标的最大值，即被卷起一侧的最大弧长。
     * 法向坐标对页面坐标是线性的，所以四角一定覆盖极值。
     * @param fold 折痕定义
     * @param pageWidth 页宽
     * @param pageHeight 页高
     * @returns 四角法向坐标的最大值
     */
    private _resolveMaxB(fold: IHrzPageCurlFold, pageWidth: number, pageHeight: number): number {
        // 折痕是直线时极值一定在四角；折痕可弯之后它平移了，所以按网格采样更稳。
        const stepX: number = Math.max(1, pageWidth / MAX_B_SAMPLES);
        const stepY: number = Math.max(1, pageHeight / MAX_B_SAMPLES);
        let maxB: number = -Infinity;
        for (let x: number = 0; x <= pageWidth; x += stepX) {
            for (let y: number = 0; y <= pageHeight; y += stepY) {
                const a: number = (x - fold.ax) * fold.tx + (y - fold.ay) * fold.ty;
                const b: number = (x - fold.ax) * fold.nx + (y - fold.ay) * fold.ny
                    - this._resolvePeelOffset(a, fold, pageWidth, pageHeight);
                if (b > maxB) {
                    maxB = b;
                }
            }
        }
        return maxB;
    }

    /**
     * 求页面上沿折痕方向的坐标 a 的最大值（即折痕的"上端"）。
     * 四个角一定覆盖极值，因为 a 对页面坐标是线性的。
     * @param fold 折痕定义
     * @param pageWidth 页宽
     * @param pageHeight 页高
     * @returns 页面上的最大 a
     */
    private _resolveFoldMaxA(fold: IHrzPageCurlFold, pageWidth: number, pageHeight: number): number {
        let maxA: number = -Infinity;
        const xs: number[] = [0, pageWidth];
        const ys: number[] = [0, pageHeight];
        for (let i: number = 0; i < xs.length; i++) {
            for (let j: number = 0; j < ys.length; j++) {
                const a: number = (xs[i] - fold.ax) * fold.tx + (ys[j] - fold.ay) * fold.ty;
                if (a > maxA) {
                    maxA = a;
                }
            }
        }
        return maxA;
    }

    /**
     * 求折痕（剥离线）在参数 a 处、相对直线沿法向外移的距离。
     *
     * `foldCurvature = 0` 时恒为 0（折痕是直线，原行为）。
     * 大于 0 时折痕两端朝"已经翻起"的方向外移，于是**两端滞后**——
     * 这正是参考视频里那条边：上端笔直，底端整段拖尾成 S 形
     * （实测帧 20 拖尾 +110px、帧 24 +236px，页宽约 850px）。
     *
     * 关键：这个外移量同时会加回到平直区域的映射里
     * （`paper = A + a·t + (b + offset)·n`），所以未翻起的部分**严格保持原样**，
     * 不会被弯曲拧到；`bendAngle = 0`（静止态）时更是逐点等于原始位置。
     *
     * @param a 沿折痕方向的坐标
     * @param fold 折痕定义
     * @param pageWidth 页宽
     * @param pageHeight 页高
     * @returns 该处折痕的外移距离，可为 0
     */
    private _resolvePeelOffset(a: number, fold: IHrzPageCurlFold, pageWidth: number, pageHeight: number): number {
        const curvature: number = this._currentCurvature;
        if (curvature === 0 || pageWidth <= 0) {
            return 0;
        }

        // 参考端取折痕方向上的"上端"（页面四角中 a 最大的那个）：
        // 于是上端不偏移、越靠近下端偏移越大 —— 和视频里"上端笔直、下端拖尾"一致。
        // 参考端固定在页面上（不随动画移动），所以拖动过程中形状是稳定的。
        const aRef: number = this._resolveFoldMaxA(fold, pageWidth, pageHeight);
        const ratio: number = Math.max(0, (aRef - a) / Math.max(1, pageWidth));
        const limit: number = this._currentRadius * MAX_PEEL_OFFSET_RATIO;
        const tail: number = Math.pow(ratio, PEEL_TAIL_POWER);
        return Math.max(-limit, Math.min(limit, curvature * tail * this._currentRadius));
    }

    /**
     * 弯折段弧长：半径固定的圆弧。
     * @param bendAngle 弯折总角度（弧度）
     * @returns 弯折段沿法向的长度
     */
    private _resolveBendLength(bendAngle: number, radius: number): number {
        if (bendAngle <= 0) {
            return 0;
        }
        return radius * bendAngle;
    }

    /**
     * 求解分界点：表面法线偏转角刚好达到 90 度时的法向坐标。
     *
     * 折痕内侧是平直段、偏转角恒为 0，一定是正面；折痕外侧先按半径弯折、偏转角随弧长线性
     * 增长，超过 90 度后转为背面。
     *
     * @param bendAngle 弯折总角度（弧度）
     * @param maxB 被卷起一侧的最大法向坐标
     * @returns 分界点的法向坐标
     */
    /**
     * 求分界点：表面法线偏转角刚好达到 90 度时的法向坐标。
     *
     * 两层用同一个函数、同一个半径，分界线上仍然严丝合缝。
     *
     * @param bendAngle 弯折总角度（弧度）
     * @param maxB 被卷起一侧的最大法向坐标
     * @returns 分界点的法向坐标
     */
    private _resolveSplitB(bendAngle: number, maxB: number, radius: number): number {
        const quarter: number = Math.PI / 2;
        if (bendAngle <= quarter) {
            // 弯折还没到 90 度，整张卡都是正面。
            return maxB;
        }
        // 分界弧长 = 半径 × π/2：表面法线刚好转过 90 度处。
        return Math.min(maxB, radius * quarter);
    }

    /**
     * 卷曲映射：把页面坐标映射成变形后的页面坐标与深度。
     *
     * 先换算到折痕坐标系：`a` 沿折痕方向、`b` 沿法向。折痕内侧（b <= 0）保持平直；
     * 外侧先绕折痕按固定半径弯折，超过弯折段后沿该角度继续平直。
     * 这是「一套函数、两段取值」里那唯一一套函数：两层网格只是喂给它不同的 b 区间。
     *
     * @param pageX 页面横向坐标
     * @param pageY 页面纵向坐标（0 = 底边）
     * @param fold 折痕定义
     * @param bendAngle 弯折总角度（弧度）
     * @param side 本层占哪半边：−1 = 正面层（取 b ≤ 分界点）、+1 = 背面层（取 b ≥ 分界点）
     * @param maxB 页面上法向坐标的最大值
     * @param pageWidth 页宽
     * @param pageHeight 页高
     * @returns 映射后的页面坐标、深度与法线偏转角
     */
    private _mapVertex(
        pageX: number,
        pageY: number,
        fold: IHrzPageCurlFold,
        bendAngle: number,
        side: number,
        maxB: number,
        pageWidth: number,
        pageHeight: number,
    ): IHrzPageCurlPoint {
        // 折痕坐标系里的两个分量：a 沿折痕方向、b 沿法向。
        // 折痕本身可以弯：`offset(a)` 是它在该处相对直线沿法向的外移量。
        // 于是"到折痕的距离"是 `b = 直线距离 − offset(a)`。
        const linearB: number = (pageX - fold.ax) * fold.nx + (pageY - fold.ay) * fold.ny;
        const a: number = (pageX - fold.ax) * fold.tx + (pageY - fold.ay) * fold.ty;
        const offset: number = this._resolvePeelOffset(a, fold, pageWidth, pageHeight);
        const radius: number = this._currentRadius;
        const splitB: number = this._resolveSplitB(bendAngle, maxB, radius);
        const seamOverlap: number = side > 0 && splitB > 0 ? Math.min(6, splitB * 0.06) : 0;
        // 越界顶点夹到分界线上：两层各自只覆盖自己那半边，塌陷区的三角形面积为零，不会画出来。
        const b: number = side < 0
            ? Math.min(linearB - offset, splitB)
            : Math.max(linearB - offset, splitB - seamOverlap);

        if (b <= 0 || bendAngle <= 0) {
            // 平直区域的位置必须由 (a, b) **加上折痕外移**反算：
            // `b + offset(a)` 正好等于原始的直线距离，所以未翻起的部分逐点不动，
            // 页面保持严格刚性；而被夹到分界线的顶点则准确落在（弯的）折痕上。
            const flat: number = b + offset;
            return {
                x: fold.ax + a * fold.tx + flat * fold.nx,
                y: fold.ay + a * fold.ty + flat * fold.ny,
                z: 0,
                angle: 0,
            };
        }

        const bendLength: number = this._resolveBendLength(bendAngle, radius);

        let alongN: number = 0;
        let z: number = 0;
        let angle: number = bendAngle;
        if (b <= bendLength) {
            // 圆弧段：从折痕处相切出发，边弯折边朝观察者抬起。
            angle = bendAngle * b / bendLength;
            alongN = radius * Math.sin(angle);
            z = radius * (1 - Math.cos(angle));
        } else {
            // 平直段：从圆弧末端沿弯折总角度的方向继续延伸。
            alongN = radius * Math.sin(bendAngle) + (b - bendLength) * Math.cos(bendAngle);
            z = radius * (1 - Math.cos(bendAngle)) + (b - bendLength) * Math.sin(bendAngle);
        }

        // 加上折痕外移量：b → 0 时 alongN → 0，位置正好回到（弯的）折痕上，和平直区域连续。
        const total: number = alongN + offset;
        return {
            x: fold.ax + a * fold.tx + total * fold.nx,
            y: fold.ay + a * fold.ty + total * fold.ny,
            z: z,
            angle: angle,
        };
    }

    /**
     * 为一层网格原地写入顶点。
     *
     * 网格是覆盖整页的规则二维网格；每个顶点先按法向坐标夹到本层的区间，再交给 `_mapVertex`。
     * 顶点坐标要换算到 SpriteFrame 像素空间：引擎网格 assembler 会按 节点尺寸 / 矩形尺寸 做缩放，
     * 先在页面空间算好再乘回去，最终才会正好落到节点尺寸。绕折痕翻过去的部分会落到页面之外
     * （负坐标），这正是需要的效果。
     *
     * @param layer 目标层
     * @param side 本层占哪半边：−1 = 正面层、+1 = 背面层
     * @param maxB 页面上法向坐标的最大值
     * @param pageWidth 页宽
     * @param pageHeight 页高
     * @param rows 纵向分段数
     * @param columns 横向分段数
     * @param fold 折痕定义
     * @param bendAngle 弯折总角度
     */
    private _writeLayer(
        layer: IHrzPageCurlLayer,
        side: number,
        maxB: number,
        pageWidth: number,
        pageHeight: number,
        rows: number,
        columns: number,
        fold: IHrzPageCurlFold,
        bendAngle: number,
    ): void {
        const frame: HrzPageCurlFrame = layer.frame as HrzPageCurlFrame;
        const texture: cc.Texture2D = frame.getTexture();
        if (!texture) {
            return;
        }

        const vertexCount: number = (rows + 1) * (columns + 1);
        if (!layer.vertices || layer.vertices.x.length !== vertexCount) {
            layer.vertices = this._createVertices(rows, columns);
            frame.vertices = layer.vertices;
        }

        const vertices: IHrzPageCurlVertices = layer.vertices;
        const rect: cc.Rect = frame.getRect();
        const toFrameX: number = rect.width / pageWidth;
        const toFrameY: number = rect.height / pageHeight;
        const mirrorU: boolean = layer.mirrorU;
        const flipY: boolean = layer.textureFlipY;
        // 透视：焦距取 页宽/强度，强度为 0 时退化成不做投影。全部在页面坐标里算，单位一致。
        const strength: number = this._resolvePerspectiveStrength();
        const focal: number = strength > 0 ? pageWidth / strength : 0;
        const centerX: number = pageWidth * cc.misc.clamp01(this.perspectiveCenterX);
        const centerY: number = pageHeight * cc.misc.clamp01(this.perspectiveCenterY);
        let index: number = 0;

        for (let row: number = 0; row <= rows; row++) {
            const pageY: number = pageHeight * row / rows;
            // 纹理 v 在 Cocos 里是向下增大的：v 最小对应图片顶边，v 最大对应底边。
            // 依据 CCSpriteFrame._calculateUV：顶点的 t = rect.y / texh、b = (rect.y + rect.height) / texh，
            // 而引擎把 t 给了上边顶点、b 给了下边顶点。写反会让整张图上下颠倒。
            //
            // RenderTexture 的 v 方向与普通图片相反：截图帧上的 setFlipY(true) 只改四边形路径的 uv[]，
            // 网格 assembler 直接读 nu/nv，翻不过来，所以这里按 textureFlipY 自己把 v 反一下。
            const vFromTop: number = flipY ? pageY / pageHeight : 1 - pageY / pageHeight;
            const pixelV: number = rect.y + vFromTop * rect.height;
            const nv: number = pixelV / texture.height;

            for (let col: number = 0; col <= columns; col++) {
                const pageX: number = pageWidth * col / columns;
                const point: IHrzPageCurlPoint = this._mapVertex(
                    pageX,
                    pageY,
                    fold,
                    bendAngle,
                    side,
                    maxB,
                    pageWidth,
                    pageHeight,
                );
                // UV 跟着纸面走，用变形前的页面坐标，纸弯了纹理才跟着弯。
                const paperU: number = pageWidth > 0 ? pageX / pageWidth : 0;
                const sampleU: number = mirrorU ? 1 - paperU : paperU;
                const pixelU: number = rect.x + sampleU * rect.width;
                // 透视投影：离观察者越近（z 越大）放大越多，投影中心取相机正对的那个点。
                // 收尾展平阶段 z 趋于 0，系数回到 1，落点不变。
                let scale: number = 1;
                if (focal > 0) {
                    scale = focal / Math.max(1, focal - point.z);
                }
                const projectedX: number = centerX + (point.x - centerX) * scale;
                const projectedY: number = centerY + (point.y - centerY) * scale;

                // 顶点 y 以图片顶边为 0，所以要用变形后的纵坐标反算。
                const frameY: number = rect.height - projectedY * toFrameY;

                vertices.x[index] = projectedX * toFrameX;
                vertices.y[index] = frameY;
                vertices.u[index] = pixelU;
                vertices.v[index] = pixelV;
                vertices.nu[index] = pixelU / texture.width;
                vertices.nv[index] = nv;
                index++;
            }
        }
    }

    /**
     * 创建一份顶点容器并预先填好三角形索引；位置与 UV 逐帧写入。
     * @param rows 纵向分段数
     * @param columns 横向分段数
     * @returns 已分配数组的顶点容器
     */
    private _createVertices(rows: number, columns: number): IHrzPageCurlVertices {
        const vertexCount: number = (rows + 1) * (columns + 1);
        const triangles: number[] = [];
        const stride: number = columns + 1;
        for (let row: number = 0; row < rows; row++) {
            for (let col: number = 0; col < columns; col++) {
                const topLeft: number = row * stride + col;
                const topRight: number = topLeft + 1;
                const bottomLeft: number = topLeft + stride;
                const bottomRight: number = bottomLeft + 1;
                triangles.push(topLeft, topRight, bottomLeft);
                triangles.push(topRight, bottomRight, bottomLeft);
            }
        }

        return {
            x: new Array<number>(vertexCount),
            y: new Array<number>(vertexCount),
            u: new Array<number>(vertexCount),
            v: new Array<number>(vertexCount),
            nu: new Array<number>(vertexCount),
            nv: new Array<number>(vertexCount),
            triangles: triangles,
        };
    }

    /**
     * 标记一层需要重新上传顶点。
     *
     * 两个标记缺一不可：渲染流程只在 FLAG_UPDATE_RENDER_DATA 置位时才调用
     * assembler.updateRenderData，而网格 assembler 又只在 _vertsDirty 为真时才重算顶点。
     * @param sprite 目标 Sprite
     */
    private _markDirty(sprite: cc.Sprite): void {
        const dirtySprite: HrzPageCurlSprite = sprite as HrzPageCurlSprite;
        dirtySprite._vertsDirty = true;

        if (!HRZ_PAGE_CURL_RENDER_FLOW || !sprite.node) {
            return;
        }
        const dirtyNode: HrzPageCurlNode = sprite.node as HrzPageCurlNode;
        dirtyNode._renderFlag |= HRZ_PAGE_CURL_RENDER_FLOW.FLAG_UPDATE_RENDER_DATA;
    }
}

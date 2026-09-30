import { HrzNodeUtils } from './HrzNodeUtils';

const { ccclass, property } = cc._decorator;

const COLUMNS: number = 96;
const ROWS: number = 96;
const PERSPECTIVE_STRENGTH: number = 0.18;
const CORNER_ANGLE: number = Math.PI / 4;
const STRAIGHTEN_START: number = 0.28;
const TURN_SPAN: number = 0.9;
const CURL_RADIUS: number = 110;
const CAPTURE_SCALE: number = 1;
const SEAM_OVERLAP: number = 6;
const MESH_TYPE: cc.Sprite.Type = 4 as cc.Sprite.Type;

interface MeshVertices {
    x: number[];
    y: number[];
    u: number[];
    v: number[];
    nu: number[];
    nv: number[];
    triangles: number[];
}

interface PageRecord {
    node: cc.Node;
    sprite: cc.Sprite | null;
    addedSprite: boolean;
    originalFrame: cc.SpriteFrame | null;
    originalType: cc.Sprite.Type;
    originalSizeMode: cc.Sprite.SizeMode;
    originalActive: boolean;
    originalZIndex: number;
    originalSize: cc.Size;
    originalPosition: cc.Vec2;
    childStates: Array<{ node: cc.Node; active: boolean }>;
    capturedFrame: cc.SpriteFrame | null;
    meshFrame: cc.SpriteFrame | null;
    vertices: MeshVertices | null;
}

interface FlipSources {
    front: cc.Node;
    back: cc.Node;
    frontActive: boolean;
    backActive: boolean;
    backPosition: cc.Vec2;
    frontCenter: cc.Vec2;
}

interface Fold {
    x: number;
    y: number;
    nx: number;
    ny: number;
    tx: number;
    ty: number;
}

type MeshFrame = cc.SpriteFrame & { vertices: MeshVertices };
type DirtySprite = cc.Sprite & { _vertsDirty: boolean };
type DirtyNode = cc.Node & { _renderFlag: number };
type RenderFlow = { FLAG_UPDATE_RENDER_DATA: number };

@ccclass
export default class HrzPageCurl extends cc.Component {
    @property(cc.Node)
    public frontNode: cc.Node | null = null;

    @property(cc.Node)
    public backNode: cc.Node | null = null;

    @property({ tooltip: '翻页时长（秒）' })
    public duration: number = 1.6;

    private _front: PageRecord | null = null;
    private _back: PageRecord | null = null;
    private _sources: FlipSources | null = null;
    private _turningRight: boolean = false;
    private _preparing: boolean = false;
    private _playing: boolean = false;
    private _elapsed: number = 0;
    private _resolve: (() => void) | null = null;

    /** 推进当前翻页，并在最后一帧把截图交还给真实背面节点。 */
    protected update(dt: number): void {
        if (!this._playing) {
            return;
        }

        this._elapsed += dt;
        const linear: number = Math.min(1, this._elapsed / Math.max(0.001, this.duration));
        const progress: number = linear < 0.5
            ? 2 * linear * linear
            : 1 - Math.pow(2 - 2 * linear, 2) / 2;
        this._refresh(progress);

        if (linear === 1) {
            this._playing = false;
            try {
                this._finishFlip();
            } catch (error) {
                this._rollback();
                console.warn('[HrzPageCurl] 翻页收尾失败', error);
            }
            const resolve: (() => void) | null = this._resolve;
            this._resolve = null;
            if (resolve) {
                resolve();
            }
        }
    }

    /**
     * 截取两棵真实节点树并播放网格翻页；播放中的重复调用直接忽略。
     * 截图源必须独立于承载节点，控制节点的原点作为书脊。
     *
     * @param frontSource 当前可交互的页面，截图后隐藏。
     * @param backSource 下一页，可先放在屏幕外；结束后永久移到书脊另一侧。
     * @param turnRight true 表示从左向右翻，默认从右向左翻。
     * @returns 本次动画和真实节点交接完成后 resolve。
     */
    public async play(frontSource: cc.Node, backSource: cc.Node, turnRight: boolean = false): Promise<void> {
        if (this._playing || this._preparing) {
            return;
        }

        if (!this.node.activeInHierarchy || !this.frontNode || !this.backNode || !frontSource || !backSource
            || !cc.isValid(frontSource) || !cc.isValid(backSource) || frontSource === backSource
            || !frontSource.activeInHierarchy || !backSource.parent || !backSource.parent.activeInHierarchy) {
            throw new Error('翻页节点或截图源无效');
        }
        if (this.frontNode.parent !== this.node || this.backNode.parent !== this.node) {
            throw new Error('正反面承载节点必须是翻页控制节点的子节点');
        }
        if (this.frontNode.width <= 0 || this.frontNode.height <= 0
            || this.frontNode.width !== this.backNode.width
            || this.frontNode.height !== this.backNode.height) {
            throw new Error('正反面承载节点必须设置相同的非零尺寸');
        }
        if (this.frontNode.children.some((child: cc.Node): boolean => child.active)
            || this.backNode.children.some((child: cc.Node): boolean => child.active)) {
            throw new Error('正反面承载节点只能用于临时截图，请移出其可见子节点');
        }
        if (this._isInHostTree(frontSource) || this._isInHostTree(backSource)) {
            throw new Error('截图源与承载节点必须分开');
        }

        this._turningRight = turnRight;
        this._front = this._record(this.frontNode);
        this._back = this._record(this.backNode);
        this._sources = {
            front: frontSource,
            back: backSource,
            frontActive: frontSource.active,
            backActive: backSource.active,
            backPosition: backSource.getPosition().clone(),
            frontCenter: this._getWorldCenter(frontSource),
        };
        const frontRecord: PageRecord = this._front;
        const backRecord: PageRecord = this._back;
        const sources: FlipSources = this._sources;
        this._preparing = true;

        try {
            const frontFrame: cc.SpriteFrame | null =
                await HrzNodeUtils.captureNodeToSpriteFrame(frontSource, CAPTURE_SCALE);
            if (!cc.isValid(this)) {
                HrzNodeUtils.releaseCapturedSpriteFrame(frontFrame);
                return;
            }
            if (!frontFrame) {
                throw new Error('正面节点截图失败');
            }
            frontRecord.capturedFrame = frontFrame;
            backSource.active = true;
            try {
                backRecord.capturedFrame = HrzNodeUtils.captureNodeToSpriteFrameImmediate(backSource, CAPTURE_SCALE);
            } finally {
                backSource.active = sources.backActive;
            }
            if (!backRecord.capturedFrame) {
                throw new Error('背面节点截图失败');
            }

            frontSource.active = false;
            backSource.active = false;
            this._alignHost(frontRecord.node, sources.frontCenter);
            this._alignHost(backRecord.node, sources.frontCenter);
            this._attachMesh(frontRecord);
            this._attachMesh(backRecord);
            frontRecord.node.zIndex = frontRecord.originalZIndex;
            backRecord.node.zIndex = frontRecord.node.zIndex + 1;
            this._elapsed = 0;
            this._refresh(0);
            frontRecord.node.active = true;
            backRecord.node.active = true;
            this._preparing = false;
            this._playing = true;
        } catch (error) {
            this._rollback();
            throw error;
        }

        await new Promise<void>((resolve: () => void): void => {
            this._resolve = resolve;
        });
    }

    /** 销毁时恢复尚未完成的源节点，并释放临时网格和截图。 */
    protected onDestroy(): void {
        this._rollback();
        const resolve: (() => void) | null = this._resolve;
        this._resolve = null;
        if (resolve) {
            resolve();
        }
    }

    /** 保存承载节点原状态，供本次播放完成后还原。 */
    private _record(node: cc.Node): PageRecord {
        const sprite: cc.Sprite = node.getComponent(cc.Sprite);
        return {
            node: node,
            sprite: sprite,
            addedSprite: false,
            originalFrame: sprite ? sprite.spriteFrame : null,
            originalType: sprite ? sprite.type : 0 as cc.Sprite.Type,
            originalSizeMode: sprite ? sprite.sizeMode : cc.Sprite.SizeMode.CUSTOM,
            originalActive: node.active,
            originalZIndex: node.zIndex,
            originalSize: cc.size(node.width, node.height),
            originalPosition: node.getPosition().clone(),
            childStates: node.children.map((child: cc.Node): { node: cc.Node; active: boolean } => ({
                node: child,
                active: child.active,
            })),
            capturedFrame: null,
            meshFrame: null,
            vertices: null,
        };
    }

    /** 把截图装到承载节点的临时网格 Sprite，并隐藏其原有子节点。 */
    private _attachMesh(record: PageRecord): void {
        const captured: cc.SpriteFrame = record.capturedFrame!;
        const rect: cc.Rect = captured.getRect();
        const mesh: cc.SpriteFrame = new cc.SpriteFrame();
        mesh.setTexture(
            captured.getTexture(),
            cc.rect(rect.x, rect.y, rect.width, rect.height),
            false,
            cc.v2(0, 0),
            cc.size(rect.width, rect.height),
        );
        record.meshFrame = mesh;
        record.vertices = this._createVertices();
        (mesh as MeshFrame).vertices = record.vertices;

        if (!record.sprite) {
            record.sprite = record.node.addComponent(cc.Sprite);
            record.addedSprite = true;
        }
        record.sprite.spriteFrame = mesh;
        record.sprite.type = MESH_TYPE;
        record.sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        for (const childState of record.childStates) {
            childState.node.active = false;
        }
    }

    /** 读取节点自身矩形的世界中心，避免锚点不在中心时错位。 */
    private _getWorldCenter(node: cc.Node): cc.Vec2 {
        return node.convertToWorldSpaceAR(cc.v2(
            (0.5 - node.anchorX) * node.width,
            (0.5 - node.anchorY) * node.height,
        ));
    }

    /** 判断截图源是否与承载节点存在父子关系，防止截图或显隐时互相影响。 */
    private _isInHostTree(source: cc.Node): boolean {
        const hosts: cc.Node[] = [this.frontNode!, this.backNode!];
        for (const host of hosts) {
            let ancestor: cc.Node | null = source;
            while (ancestor) {
                if (ancestor === host) {
                    return true;
                }
                ancestor = ancestor.parent;
            }
            ancestor = host;
            while (ancestor) {
                if (ancestor === source) {
                    return true;
                }
                ancestor = ancestor.parent;
            }
        }
        return false;
    }

    /** 平移承载节点，使其矩形中心对齐正面源节点的世界中心。 */
    private _alignHost(host: cc.Node, worldCenter: cc.Vec2): void {
        const parent: cc.Node = host.parent;
        const target: cc.Vec2 = parent.convertToNodeSpaceAR(worldCenter);
        const current: cc.Vec2 = parent.convertToNodeSpaceAR(this._getWorldCenter(host));
        host.setPosition(host.x + target.x - current.x, host.y + target.y - current.y);
    }

    /** 将真实背面节点移到书脊另一侧，并交还真实节点的可见与交互状态。 */
    private _finishFlip(): void {
        const sources: FlipSources = this._sources!;
        const backParent: cc.Node = sources.back.parent;
        const frontLocal: cc.Vec2 = this.node.convertToNodeSpaceAR(sources.frontCenter);
        const landingWorld: cc.Vec2 = this.node.convertToWorldSpaceAR(
            cc.v2(-frontLocal.x, frontLocal.y),
        );
        const landingLocal: cc.Vec2 = backParent.convertToNodeSpaceAR(landingWorld);
        const currentLocal: cc.Vec2 = backParent.convertToNodeSpaceAR(this._getWorldCenter(sources.back));
        sources.back.setPosition(
            sources.back.x + landingLocal.x - currentLocal.x,
            sources.back.y + landingLocal.y - currentLocal.y,
        );
        sources.back.active = true;
        this._restore(this._front);
        this._restore(this._back);
        this._front = null;
        this._back = null;
        this._sources = null;
    }

    /** 截图失败或组件销毁时回退源节点与承载节点，避免留下半张页面。 */
    private _rollback(): void {
        this._preparing = false;
        this._playing = false;
        if (this._sources) {
            if (cc.isValid(this._sources.front)) {
                this._sources.front.active = this._sources.frontActive;
            }
            if (cc.isValid(this._sources.back)) {
                this._sources.back.setPosition(this._sources.backPosition);
                this._sources.back.active = this._sources.backActive;
            }
        }
        this._restore(this._front);
        this._restore(this._back);
        this._front = null;
        this._back = null;
        this._sources = null;
    }

    /** 以当前进度计算两面网格顶点并通知 Cocos 更新渲染数据。 */
    private _refresh(progress: number): void {
        if (!this._front || !this._back) {
            return;
        }
        const width: number = this._front.node.width;
        const height: number = this._front.node.height;
        const radius: number = CURL_RADIUS * (1 - this._landing(progress));
        const fold: Fold = this._fold(progress, width, radius);
        const bendAngle: number = Math.PI * Math.min(1, progress / TURN_SPAN);
        const maxB: number = Math.max(
            (0 - fold.x) * fold.nx + (0 - fold.y) * fold.ny,
            (width - fold.x) * fold.nx + (0 - fold.y) * fold.ny,
            (0 - fold.x) * fold.nx + (height - fold.y) * fold.ny,
            (width - fold.x) * fold.nx + (height - fold.y) * fold.ny,
        );

        this._writeLayer(this._front, false, width, height, radius, fold, bendAngle, maxB);
        this._writeLayer(this._back, true, width, height, radius, fold, bendAngle, maxB);
        this._markDirty(this._front.sprite!);
        this._markDirty(this._back.sprite!);
    }

    /** 在翻页尾段把卷曲半径平滑收至零。 */
    private _landing(progress: number): number {
        if (progress <= TURN_SPAN) {
            return 0;
        }
        const linear: number = (progress - TURN_SPAN) / (1 - TURN_SPAN);
        return linear * linear * (3 - 2 * linear);
    }

    /** 计算从页角移动到书脊的斜折痕。 */
    private _fold(progress: number, width: number, radius: number): Fold {
        const straighten: number = Math.max(0, (progress - STRAIGHTEN_START) / (1 - STRAIGHTEN_START));
        const angle: number = CORNER_ANGLE + (Math.PI / 2 - CORNER_ANGLE) * straighten;
        const nx: number = Math.sin(angle);
        const ny: number = -Math.cos(angle);
        const margin: number = radius * 0.45;
        const offset: number = margin - progress * (width + radius + margin);
        return {
            x: width + nx * offset,
            y: ny * offset,
            nx: nx,
            ny: ny,
            tx: Math.cos(angle),
            ty: Math.sin(angle),
        };
    }

    /** 把纸面坐标映射为网格坐标，并保留纹理对应的 UV。 */
    private _writeLayer(
        record: PageRecord,
        back: boolean,
        width: number,
        height: number,
        radius: number,
        fold: Fold,
        bendAngle: number,
        maxB: number,
    ): void {
        const vertices: MeshVertices = record.vertices!;
        const rect: cc.Rect = record.meshFrame!.getRect();
        const texture: cc.Texture2D = record.meshFrame!.getTexture();
        const splitB: number = bendAngle <= Math.PI / 2 ? maxB : Math.min(maxB, radius * Math.PI / 2);
        const overlap: number = back && splitB > 0 ? Math.min(SEAM_OVERLAP, splitB * 0.06) : 0;
        const focal: number = width / PERSPECTIVE_STRENGTH;
        let index: number = 0;

        for (let row: number = 0; row <= ROWS; row++) {
            const sourceY: number = height * row / ROWS;
            const pixelV: number = rect.y + sourceY / height * rect.height;
            for (let col: number = 0; col <= COLUMNS; col++) {
                const sourceX: number = width * col / COLUMNS;
                const geometryX: number = this._turningRight ? width - sourceX : sourceX;
                const a: number = (geometryX - fold.x) * fold.tx + (sourceY - fold.y) * fold.ty;
                const linearB: number = (geometryX - fold.x) * fold.nx + (sourceY - fold.y) * fold.ny;
                const b: number = back ? Math.max(linearB, splitB - overlap) : Math.min(linearB, splitB);
                let alongN: number = b;
                let depth: number = 0;

                if (b > 0 && bendAngle > 0) {
                    const bendLength: number = radius * bendAngle;
                    if (b <= bendLength) {
                        const angle: number = b / radius;
                        alongN = radius * Math.sin(angle);
                        depth = radius * (1 - Math.cos(angle));
                    } else {
                        alongN = radius * Math.sin(bendAngle) + (b - bendLength) * Math.cos(bendAngle);
                        depth = radius * (1 - Math.cos(bendAngle)) + (b - bendLength) * Math.sin(bendAngle);
                    }
                }

                const x: number = fold.x + a * fold.tx + alongN * fold.nx;
                const y: number = fold.y + a * fold.ty + alongN * fold.ny;
                const scale: number = focal / Math.max(1, focal - depth);
                const projectedX: number = width / 2 + (x - width / 2) * scale;
                const projectedY: number = height / 2 + (y - height / 2) * scale;
                const pixelU: number = rect.x + (back ? 1 - sourceX / width : sourceX / width) * rect.width;

                vertices.x[index] = (this._turningRight ? width - projectedX : projectedX) * rect.width / width;
                vertices.y[index] = rect.height - projectedY * rect.height / height;
                vertices.u[index] = pixelU;
                vertices.v[index] = pixelV;
                vertices.nu[index] = pixelU / texture.width;
                vertices.nv[index] = pixelV / texture.height;
                index++;
            }
        }
    }

    /** 为一面页面创建固定拓扑的二维网格。 */
    private _createVertices(): MeshVertices {
        const count: number = (ROWS + 1) * (COLUMNS + 1);
        const triangles: number[] = [];
        for (let row: number = 0; row < ROWS; row++) {
            for (let col: number = 0; col < COLUMNS; col++) {
                const topLeft: number = row * (COLUMNS + 1) + col;
                const topRight: number = topLeft + 1;
                const bottomLeft: number = topLeft + COLUMNS + 1;
                const bottomRight: number = bottomLeft + 1;
                triangles.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
            }
        }
        return {
            x: new Array<number>(count),
            y: new Array<number>(count),
            u: new Array<number>(count),
            v: new Array<number>(count),
            nu: new Array<number>(count),
            nv: new Array<number>(count),
            triangles: triangles,
        };
    }

    /** 标记 Sprite 网格与节点渲染数据需要重新上传。 */
    private _markDirty(sprite: cc.Sprite): void {
        (sprite as DirtySprite)._vertsDirty = true;
        const renderFlow: RenderFlow = (cc as unknown as { RenderFlow: RenderFlow }).RenderFlow;
        (sprite.node as DirtyNode)._renderFlag |= renderFlow.FLAG_UPDATE_RENDER_DATA;
    }

    /** 释放单次播放创建的网格帧和截图纹理。 */
    private _releaseFrames(record: PageRecord): void {
        if (record.meshFrame) {
            record.meshFrame.destroy();
            record.meshFrame = null;
        }
        if (record.capturedFrame) {
            HrzNodeUtils.releaseCapturedSpriteFrame(record.capturedFrame);
            record.capturedFrame = null;
        }
    }

    /** 移除临时 Sprite 并恢复承载节点原有状态。 */
    private _restore(record: PageRecord | null): void {
        if (!record) {
            return;
        }
        if (!cc.isValid(record.node)) {
            this._releaseFrames(record);
            return;
        }
        for (const childState of record.childStates) {
            if (cc.isValid(childState.node)) {
                childState.node.active = childState.active;
            }
        }
        if (record.addedSprite && record.sprite) {
            record.sprite.enabled = false;
            record.node.removeComponent(record.sprite);
        } else if (record.sprite) {
            record.sprite.spriteFrame = record.originalFrame!;
            record.sprite.type = record.originalType;
            record.sprite.sizeMode = record.originalSizeMode;
        }
        record.node.setContentSize(record.originalSize);
        record.node.setPosition(record.originalPosition);
        record.node.zIndex = record.originalZIndex;
        record.node.active = record.originalActive;
        this._releaseFrames(record);
    }
}

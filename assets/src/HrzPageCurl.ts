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
const SIMPLE_TYPE: cc.Sprite.Type = 0 as cc.Sprite.Type;

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
    childStates: Array<{ node: cc.Node; active: boolean }>;
    capturedFrame: cc.SpriteFrame | null;
    meshFrame: cc.SpriteFrame | null;
    vertices: MeshVertices | null;
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
    private _preparing: boolean = false;
    private _playing: boolean = false;
    private _elapsed: number = 0;
    private _resolve: (() => void) | null = null;

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
            const resolve: (() => void) | null = this._resolve;
            this._resolve = null;
            if (resolve) {
                resolve();
            }
        }
    }

    public async play(): Promise<void> {
        if (this._playing || this._preparing) {
            return;
        }

        if (!this.frontNode || !this.backNode) {
            console.warn('[HrzPageCurl] 请在编辑器中绑定正面和背面节点');
            return;
        }

        this._front = this._front || this._record(this.frontNode);
        this._back = this._back || this._record(this.backNode);
        this._preparing = true;
        this._front.node.active = true;
        this._back.node.active = false;
        this._back.node.zIndex = this._front.originalZIndex - 1;

        try {
            await this._capture(this._back, true);
            await this._capture(this._front);
            if (!cc.isValid(this)) {
                return;
            }
            this._attachMesh(this._front);
            this._attachMesh(this._back);
            this._front.node.zIndex = this._front.originalZIndex;
            this._back.node.zIndex = this._front.node.zIndex + 1;
            this._elapsed = 0;
            this._refresh(0);
            this._back.node.active = true;
            this._preparing = false;
            this._playing = true;
        } catch (error) {
            this._preparing = false;
            this._playing = false;
            this._restore(this._front);
            this._restore(this._back);
            this._front = null;
            this._back = null;
            console.warn('[HrzPageCurl] 翻页准备失败', error);
            return;
        }

        await new Promise<void>((resolve: () => void): void => {
            this._resolve = resolve;
        });
    }

    protected onDestroy(): void {
        this._preparing = false;
        this._playing = false;
        const resolve: (() => void) | null = this._resolve;
        this._resolve = null;
        if (resolve) {
            resolve();
        }
        this._restore(this._front);
        this._restore(this._back);
    }

    private _record(node: cc.Node): PageRecord {
        const sprite: cc.Sprite = node.getComponent(cc.Sprite);
        return {
            node: node,
            sprite: sprite,
            addedSprite: false,
            originalFrame: sprite ? sprite.spriteFrame : null,
            originalType: sprite ? sprite.type : SIMPLE_TYPE,
            originalSizeMode: sprite ? sprite.sizeMode : cc.Sprite.SizeMode.CUSTOM,
            originalActive: node.active,
            originalZIndex: node.zIndex,
            originalSize: cc.size(node.width, node.height),
            childStates: node.children.map((child: cc.Node): { node: cc.Node; active: boolean } => ({
                node: child,
                active: child.active,
            })),
            capturedFrame: null,
            meshFrame: null,
            vertices: null,
        };
    }

    private async _capture(record: PageRecord, immediate: boolean = false): Promise<void> {
        if (record.sprite) {
            record.sprite.spriteFrame = record.originalFrame!;
            record.sprite.type = SIMPLE_TYPE;
            record.sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        }
        for (const childState of record.childStates) {
            childState.node.active = childState.active;
        }
        this._releaseFrames(record);

        const capturedFrame: cc.SpriteFrame | null = immediate
            ? HrzNodeUtils.captureNodeToSpriteFrameImmediate(record.node, CAPTURE_SCALE)
            : await HrzNodeUtils.captureNodeToSpriteFrame(record.node, CAPTURE_SCALE);
        if (!capturedFrame) {
            throw new Error(record.node.name + ' 截图失败');
        }
        record.capturedFrame = capturedFrame;
    }

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
        if (record.node.width <= 0 || record.node.height <= 0) {
            record.node.setContentSize(rect.width, rect.height);
        }
        record.sprite.spriteFrame = mesh;
        record.sprite.type = MESH_TYPE;
        record.sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        for (const childState of record.childStates) {
            childState.node.active = false;
        }
    }

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

    private _landing(progress: number): number {
        if (progress <= TURN_SPAN) {
            return 0;
        }
        const linear: number = (progress - TURN_SPAN) / (1 - TURN_SPAN);
        return linear * linear * (3 - 2 * linear);
    }

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
                const a: number = (sourceX - fold.x) * fold.tx + (sourceY - fold.y) * fold.ty;
                const linearB: number = (sourceX - fold.x) * fold.nx + (sourceY - fold.y) * fold.ny;
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

                vertices.x[index] = projectedX * rect.width / width;
                vertices.y[index] = rect.height - projectedY * rect.height / height;
                vertices.u[index] = pixelU;
                vertices.v[index] = pixelV;
                vertices.nu[index] = pixelU / texture.width;
                vertices.nv[index] = pixelV / texture.height;
                index++;
            }
        }
    }

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

    private _markDirty(sprite: cc.Sprite): void {
        (sprite as DirtySprite)._vertsDirty = true;
        const renderFlow: RenderFlow = (cc as unknown as { RenderFlow: RenderFlow }).RenderFlow;
        (sprite.node as DirtyNode)._renderFlag |= renderFlow.FLAG_UPDATE_RENDER_DATA;
    }

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

    private _restore(record: PageRecord | null): void {
        if (!record || !cc.isValid(record.node)) {
            return;
        }
        for (const childState of record.childStates) {
            if (cc.isValid(childState.node)) {
                childState.node.active = childState.active;
            }
        }
        if (record.addedSprite && record.sprite) {
            record.node.removeComponent(record.sprite);
        } else if (record.sprite) {
            record.sprite.spriteFrame = record.originalFrame!;
            record.sprite.type = record.originalType;
            record.sprite.sizeMode = record.originalSizeMode;
        }
        record.node.setContentSize(record.originalSize);
        record.node.zIndex = record.originalZIndex;
        record.node.active = record.originalActive;
        this._releaseFrames(record);
    }
}

const { ccclass, property } = cc._decorator;

/**
 * HrzNodeScreenshotCapture - 通用 Node 树截图组件。
 *
 * 该组件独立于翻页截图逻辑，不修改目标节点 group。
 * 截图结果中的 RenderTexture 会被返回的 SpriteFrame 持有，调用方不用后需要主动释放。
 */
@ccclass
export default class HrzNodeScreenshotCapture extends cc.Component {

    /** 默认截图目标节点；也可以在 captureNodeToSpriteFrame 调用时传入。 */
    @property({ type: cc.Node, tooltip: '默认截图目标节点' })
    public targetNode: cc.Node = null;

    /** 截图像素倍率，1 表示按节点世界包围盒尺寸截图。 */
    @property({ tooltip: '截图像素倍率' })
    public textureScale: number = 1;

    /** 是否为 RenderTexture 创建 stencil buffer，用于支持 Mask 等裁剪组件。 */
    @property({ tooltip: 'RenderTexture 使用 stencil buffer' })
    public useStencilBuffer: boolean = true;

    /** RenderTexture 作为 SpriteFrame 显示时是否垂直翻转。 */
    @property({ tooltip: 'RenderTexture 垂直翻转' })
    public flipTextureY: boolean = true;

    /** 运行时创建的离屏相机节点。 */
    private _cameraNode: cc.Node = null;

    /** 运行时创建的离屏相机组件。 */
    private _camera: cc.Camera = null;

    /** 组件销毁时释放临时相机。 */
    onDestroy(): void {
        this.release();
    }

    /**
     * 等待当前帧渲染完成后，把目标节点以及所有子节点截图为 SpriteFrame。
     *
     * 调用示例：
     * ```typescript
     * const frame: cc.SpriteFrame | null = await capture.captureNodeToSpriteFrame(this.node);
     * if (frame) {
     *     targetSprite.spriteFrame = frame;
     * }
     * ```
     *
     * @param targetNode 需要截图的节点；为空时使用属性面板中的 targetNode
     * @param textureScale 可选截图像素倍率；不传时使用组件 textureScale
     * @returns 截图得到的 SpriteFrame，目标无效或尺寸无效时返回 null
     */
    public captureNodeToSpriteFrame(targetNode?: cc.Node, textureScale?: number): Promise<cc.SpriteFrame | null> {
        return new Promise<cc.SpriteFrame | null>((resolve: (value: cc.SpriteFrame | null) => void): void => {
            cc.director.once(cc.Director.EVENT_AFTER_DRAW, (): void => {
                if (!cc.isValid(this)) {
                    resolve(null);
                    return;
                }

                resolve(this.captureNodeToSpriteFrameNow(targetNode, textureScale));
            });
        });
    }

    /**
     * 等待当前帧渲染完成后，按目标节点自身 contentSize 截图。
     *
     * 与 captureNodeToSpriteFrame 不同，本方法不使用子节点包围盒计算截图范围，
     * 适合课件根节点这类需要固定 1920x1080 视口的场景。
     *
     * @param targetNode 需要截图的节点；为空时使用属性面板中的 targetNode
     * @param textureScale 可选截图像素倍率；不传时使用组件 textureScale
     * @returns 截图得到的 SpriteFrame，目标无效或尺寸无效时返回 null
     */
    public captureNodeContentToSpriteFrame(targetNode?: cc.Node, textureScale?: number, contentSize?: cc.Size): Promise<cc.SpriteFrame | null> {
        return new Promise<cc.SpriteFrame | null>((resolve: (value: cc.SpriteFrame | null) => void): void => {
            cc.director.once(cc.Director.EVENT_AFTER_DRAW, (): void => {
                if (!cc.isValid(this)) {
                    resolve(null);
                    return;
                }

                resolve(this.captureNodeContentToSpriteFrameNow(targetNode, textureScale, contentSize));
            });
        });
    }

    /**
     * 立即把目标节点以及所有子节点截图为 SpriteFrame。
     *
     * 如果调用方刚刚改过节点状态、文本、布局或动画，优先使用 captureNodeToSpriteFrame，
     * 让引擎完成一帧刷新后再截图。
     *
     * @param targetNode 需要截图的节点；为空时使用属性面板中的 targetNode
     * @param textureScale 可选截图像素倍率；不传时使用组件 textureScale
     * @returns 截图得到的 SpriteFrame，目标无效或尺寸无效时返回 null
     */
    public captureNodeToSpriteFrameNow(targetNode?: cc.Node, textureScale?: number): cc.SpriteFrame | null {
        const nodeToCapture: cc.Node = targetNode || this.targetNode;
        if (!nodeToCapture || !cc.isValid(nodeToCapture) || !nodeToCapture.activeInHierarchy) {
            console.warn('[HrzNodeScreenshotCapture]', 'targetNode 无效或未激活，无法截图');
            return null;
        }

        const worldBounds: cc.Rect = this._getNodeWorldBounds(nodeToCapture);
        return this._captureNodeWithWorldBounds(nodeToCapture, worldBounds, textureScale);
    }

    /**
     * 立即按目标节点自身 contentSize 截图。
     *
     * 如果调用方刚刚改过节点状态、文本、布局或动画，优先使用 captureNodeContentToSpriteFrame，
     * 让引擎完成一帧刷新后再截图。
     *
     * @param targetNode 需要截图的节点；为空时使用属性面板中的 targetNode
     * @param textureScale 可选截图像素倍率；不传时使用组件 textureScale
     * @returns 截图得到的 SpriteFrame，目标无效或尺寸无效时返回 null
     */
    public captureNodeContentToSpriteFrameNow(targetNode?: cc.Node, textureScale?: number, contentSize?: cc.Size): cc.SpriteFrame | null {
        const nodeToCapture: cc.Node = targetNode || this.targetNode;
        if (!nodeToCapture || !cc.isValid(nodeToCapture) || !nodeToCapture.activeInHierarchy) {
            console.warn('[HrzNodeScreenshotCapture]', 'targetNode 无效或未激活，无法截图');
            return null;
        }

        const worldBounds: cc.Rect = this._getNodeContentWorldBounds(nodeToCapture, contentSize);
        return this._captureNodeWithWorldBounds(nodeToCapture, worldBounds, textureScale);
    }

    private _captureNodeWithWorldBounds(
        nodeToCapture: cc.Node,
        worldBounds: cc.Rect,
        textureScale?: number,
    ): cc.SpriteFrame | null {
        const scale: number = Math.max(0.01, textureScale === undefined ? this.textureScale : textureScale);
        const textureSize: cc.Size = this._getTextureSize(worldBounds, scale);
        if (textureSize.width <= 0 || textureSize.height <= 0) {
            console.warn('[HrzNodeScreenshotCapture]', '截图尺寸无效', nodeToCapture.name, textureSize.width, textureSize.height);
            return null;
        }

        const renderTexture: cc.RenderTexture = this._createRenderTexture(textureSize.width, textureSize.height);
        this._ensureCamera();
        this._syncCamera(nodeToCapture, worldBounds, textureSize);
        this._camera.targetTexture = renderTexture;
        this._camera.enabled = true;

        try {
            this._camera.render(nodeToCapture);
            return this._createSpriteFrame(renderTexture, textureSize);
        } catch (error) {
            console.warn('[HrzNodeScreenshotCapture]', '截图渲染失败', this._getErrorMessage(error));
            if (cc.isValid(renderTexture)) {
                renderTexture.destroy();
            }
            return null;
        } finally {
            this._camera.enabled = false;
            this._camera.targetTexture = null;
        }
    }

    /** 释放运行时创建的临时相机。 */
    public release(): void {
        if (this._camera) {
            this._camera.enabled = false;
            this._camera.targetTexture = null;
        }

        if (this._cameraNode && cc.isValid(this._cameraNode)) {
            this._cameraNode.destroy();
        }
        this._cameraNode = null;
        this._camera = null;
    }

    /**
     * 释放由本组件截图生成的 SpriteFrame 和 RenderTexture。
     * @param spriteFrame 需要释放的截图 SpriteFrame
     */
    public static releaseCapturedSpriteFrame(spriteFrame: cc.SpriteFrame | null): void {
        if (!spriteFrame || !cc.isValid(spriteFrame)) {
            return;
        }

        const texture: cc.Texture2D = spriteFrame.getTexture();
        const capturedTexture: any = texture as any;
        if (!capturedTexture || capturedTexture.__hrzNodeScreenshotCapture !== true) {
            console.warn('[HrzNodeScreenshotCapture]', '只允许释放由截图组件创建的 SpriteFrame');
            return;
        }

        spriteFrame.destroy();
        if (texture && cc.isValid(texture)) {
            texture.destroy();
        }
    }

    /**
     * 获取目标节点树世界包围盒。
     * @param targetNode 需要截图的节点
     */
    private _getNodeWorldBounds(targetNode: cc.Node): cc.Rect {
        const worldBounds: cc.Rect = targetNode.getBoundingBoxToWorld();
        if (worldBounds.width > 0 && worldBounds.height > 0) {
            return worldBounds;
        }

        const worldPosition: cc.Vec3 = targetNode.convertToWorldSpaceAR(cc.v3(0, 0, 0));
        const width: number = Math.max(1, targetNode.width);
        const height: number = Math.max(1, targetNode.height);
        return cc.rect(
            worldPosition.x - width * targetNode.anchorX,
            worldPosition.y - height * targetNode.anchorY,
            width,
            height,
        );
    }

    /**
     * 获取目标节点自身 contentSize 的世界包围盒，不受 active 子节点范围影响。
     * @param targetNode 需要截图的节点
     */
    private _getNodeContentWorldBounds(targetNode: cc.Node, contentSize?: cc.Size): cc.Rect {
        const width: number = Math.max(1, contentSize ? contentSize.width : targetNode.width);
        const height: number = Math.max(1, contentSize ? contentSize.height : targetNode.height);
        const left: number = -width * targetNode.anchorX;
        const right: number = width * (1 - targetNode.anchorX);
        const bottom: number = -height * targetNode.anchorY;
        const top: number = height * (1 - targetNode.anchorY);
        const corners: cc.Vec3[] = [
            targetNode.convertToWorldSpaceAR(cc.v3(left, bottom, 0)),
            targetNode.convertToWorldSpaceAR(cc.v3(right, bottom, 0)),
            targetNode.convertToWorldSpaceAR(cc.v3(left, top, 0)),
            targetNode.convertToWorldSpaceAR(cc.v3(right, top, 0)),
        ];
        let minX = corners[0].x;
        let maxX = corners[0].x;
        let minY = corners[0].y;
        let maxY = corners[0].y;
        for (let index = 1; index < corners.length; index++) {
            const corner = corners[index];
            minX = Math.min(minX, corner.x);
            maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y);
            maxY = Math.max(maxY, corner.y);
        }
        return cc.rect(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
    }

    /**
     * 根据节点世界包围盒和倍率计算 RenderTexture 尺寸。
     * @param worldBounds 目标节点树世界包围盒
     * @param textureScale 截图像素倍率
     */
    private _getTextureSize(worldBounds: cc.Rect, textureScale: number): cc.Size {
        return cc.size(
            Math.max(1, Math.ceil(worldBounds.width * textureScale)),
            Math.max(1, Math.ceil(worldBounds.height * textureScale)),
        );
    }

    /**
     * 创建 RenderTexture。
     * @param width RenderTexture 宽度
     * @param height RenderTexture 高度
     */
    private _createRenderTexture(width: number, height: number): cc.RenderTexture {
        const renderTexture: cc.RenderTexture = new cc.RenderTexture();
        const stencilFormat: number = this._getStencilFormat();
        if (this.useStencilBuffer && stencilFormat !== 0) {
            const renderTextureWithStencil: any = renderTexture as any;
            renderTextureWithStencil.initWithSize(width, height, stencilFormat);
            return renderTexture;
        }

        renderTexture.initWithSize(width, height);
        return renderTexture;
    }

    /**
     * 获取当前渲染上下文里的 stencil 格式。
     * Web 环境一般是 cc.game._renderContext.STENCIL_INDEX8，Native 不存在时返回 0。
     */
    private _getStencilFormat(): number {
        const gameWithContext: any = cc.game as any;
        const renderContext: any = gameWithContext ? gameWithContext._renderContext : null;
        if (renderContext && renderContext.STENCIL_INDEX8 !== undefined) {
            return renderContext.STENCIL_INDEX8 as number;
        }
        return 0;
    }

    /** 确保离屏相机存在。 */
    private _ensureCamera(): void {
        if (this._cameraNode && cc.isValid(this._cameraNode) && this._camera) {
            return;
        }

        this._cameraNode = new cc.Node('hrz_node_screenshot_camera');
        this._camera = this._cameraNode.addComponent(cc.Camera);
        this._camera.enabled = false;
        this._camera.ortho = true;
        this._camera.alignWithScreen = false;
        this._camera.clearFlags = cc.Camera.ClearFlags.COLOR;
        this._camera.backgroundColor = new cc.Color(0, 0, 0, 0);
        this._camera.cullingMask = 0xffffffff;

        const scene: cc.Scene = cc.director.getScene();
        this._cameraNode.parent = scene || this.node;
    }

    /**
     * 对齐离屏相机，使目标世界包围盒完整填满 RenderTexture。
     * @param targetNode 需要截图的节点
     * @param worldBounds 目标节点树世界包围盒
     * @param textureSize RenderTexture 像素尺寸
     */
    private _syncCamera(targetNode: cc.Node, worldBounds: cc.Rect, textureSize: cc.Size): void {
        const sceneCamera: cc.Camera = cc.Camera.findCamera(targetNode) || cc.Camera.main;
        if (sceneCamera) {
            this._camera.renderStages = sceneCamera.renderStages;
            this._camera.nearClip = sceneCamera.nearClip;
            this._camera.farClip = sceneCamera.farClip;
        }

        const centerX: number = worldBounds.x + worldBounds.width / 2;
        const centerY: number = worldBounds.y + worldBounds.height / 2;
        const aspect: number = textureSize.height > 0 ? textureSize.width / textureSize.height : 1;
        const cameraHeight: number = Math.max(worldBounds.height, worldBounds.width / Math.max(0.0001, aspect));
        this._cameraNode.setPosition(centerX, centerY, this._getCameraZ(sceneCamera));
        this._cameraNode.setRotation(0, 0, 0, 1);
        this._camera.ortho = true;
        this._camera.alignWithScreen = false;
        this._camera.orthoSize = cameraHeight / 2;
        this._camera.zoomRatio = 1;
        this._camera.rect = cc.rect(0, 0, 1, 1);
        this._camera.clearFlags = cc.Camera.ClearFlags.COLOR;
        this._camera.backgroundColor = new cc.Color(0, 0, 0, 0);
    }

    /**
     * 获取离屏相机 z 坐标，确保 2D 节点落在 near/far 裁剪范围内。
     * @param sceneCamera 当前渲染目标节点的场景相机
     */
    private _getCameraZ(sceneCamera: cc.Camera): number {
        const sceneCameraZ: number = sceneCamera && sceneCamera.node ? sceneCamera.node.z : 0;
        return Math.max(1000, sceneCameraZ);
    }

    /**
     * 根据 RenderTexture 创建 SpriteFrame。
     * @param renderTexture 截图结果纹理
     * @param textureSize 截图纹理尺寸
     */
    private _createSpriteFrame(renderTexture: cc.RenderTexture, textureSize: cc.Size): cc.SpriteFrame {
        const frame: cc.SpriteFrame = new cc.SpriteFrame();
        const capturedTexture: any = renderTexture as any;
        capturedTexture.__hrzNodeScreenshotCapture = true;
        frame.setTexture(
            renderTexture,
            cc.rect(0, 0, textureSize.width, textureSize.height),
            false,
            cc.v2(0, 0),
            cc.size(textureSize.width, textureSize.height),
        );
        if (this.flipTextureY) {
            frame.setFlipY(true);
        }
        return frame;
    }

    /**
     * 把未知错误转成日志字符串。
     * @param error 捕获到的异常对象
     */
    private _getErrorMessage(error: any): string {
        if (error && error.message) {
            return String(error.message);
        }
        return String(error);
    }
}

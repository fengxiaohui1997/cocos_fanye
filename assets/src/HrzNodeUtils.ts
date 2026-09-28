/**
 * HrzNodeUtils（测试项目精简版）—— 只保留翻页组件用到的截图能力。
 *
 * 现网完整版 `assets/Horizon/script/shared/utils/HrzNodeUtils.ts` 集中了课件框架能力，
 * 依赖 HrzScene / HrzUIRoot / HrzController 等一整套运行时。翻页功能实际只用到下面两个函数，
 * 它们都是 `HrzNodeScreenshotCapture` 的薄包装，因此测试项目里只搬这两个。
 */

import HrzNodeScreenshotCapture from './HrzNodeScreenshotCapture';

export namespace HrzNodeUtils {

    /**
     * 把传入节点以及它的所有子节点截图成一个 SpriteFrame。
     *
     * 该方法会临时创建独立的 HrzNodeScreenshotCapture，不依赖翻页截图组件，也不会修改目标节点 group。
     * 返回的 SpriteFrame 持有 RenderTexture，调用方不再使用时需要调用 releaseCapturedSpriteFrame 释放。
     *
     * 调用示例：
     * ```typescript
     * const frame: cc.SpriteFrame | null = await HrzNodeUtils.captureNodeToSpriteFrame(cardNode);
     * if (frame) {
     *     previewSprite.spriteFrame = frame;
     * }
     *
     * // 不再使用截图后释放资源
     * HrzNodeUtils.releaseCapturedSpriteFrame(frame);
     * ```
     *
     * @param targetNode 需要截图的节点；会截图该节点以及全部 active 子节点
     * @param textureScale 可选截图像素倍率，1 表示按节点世界包围盒尺寸截图
     * @returns 截图得到的 SpriteFrame，目标无效或截图失败时返回 null
     */
    export async function captureNodeToSpriteFrame(targetNode: cc.Node, textureScale?: number): Promise<cc.SpriteFrame | null> {
        if (!targetNode || !cc.isValid(targetNode) || !targetNode.activeInHierarchy) {
            console.warn('[HrzNodeUtils]', 'captureNodeToSpriteFrame targetNode 无效或未激活');
            return null;
        }

        const captureNode: cc.Node = new cc.Node('hrz_node_screenshot_capture');
        const scene: cc.Scene = cc.director.getScene();
        captureNode.parent = scene || targetNode;

        const capture: HrzNodeScreenshotCapture = captureNode.addComponent(HrzNodeScreenshotCapture);
        try {
            return await capture.captureNodeToSpriteFrame(targetNode, textureScale);
        } finally {
            if (cc.isValid(captureNode)) {
                captureNode.destroy();
            }
        }
    }

    /**
     * 释放 captureNodeToSpriteFrame 返回的 SpriteFrame 和内部 RenderTexture。
     * @param spriteFrame 需要释放的截图 SpriteFrame
     */
    export function releaseCapturedSpriteFrame(spriteFrame: cc.SpriteFrame | null): void {
        HrzNodeScreenshotCapture.releaseCapturedSpriteFrame(spriteFrame);
    }

}

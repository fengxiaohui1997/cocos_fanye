// 测试项目入口：按钮点击后播放一次翻页。
// 翻页本体是 HrzPageCurl（挂在 pageNode 上），这里只负责触发。

const {ccclass, property} = cc._decorator;

import HrzPageCurl from './HrzPageCurl';

@ccclass
export default class GameTs extends cc.Component {

    /** 翻页组件；在编辑器里把挂了这个组件的节点拖进来。留空时自动在场景里找。 */
    @property({ type: HrzPageCurl, tooltip: '翻页组件（留空则自动在场景中查找）' })
    public pageCurl: HrzPageCurl = null;

    /** 启动时打印实际生效的抗锯齿状态，用来确认 HrzAntiAliasBoot 的宏有没有赶上上下文创建。 */
    protected onLoad(): void {
        const game: { _renderContext?: WebGLRenderingContext } = cc.game as unknown as { _renderContext?: WebGLRenderingContext };
        const context: WebGLRenderingContext = game._renderContext;
        const attributes: WebGLContextAttributes = context && context.getContextAttributes ? context.getContextAttributes() : null;
        console.log('[GameTs] WebGL antialias =', attributes ? attributes.antialias : 'unknown');
    }

    /** 按钮回调：播放一次翻页。 */
    public testFanYe(): void {
        const curl: HrzPageCurl = this.pageCurl || this._findPageCurl();
        if (!curl) {
            console.warn('[GameTs] 场景里没有 HrzPageCurl 组件');
            return;
        }

        curl.play().catch((error: Error): void => {
            console.warn('[GameTs] 翻页播放失败', error);
        });
    }

    /** 在整个场景里找翻页组件；没手动指定 pageCurl 时用。 */
    private _findPageCurl(): HrzPageCurl {
        const scene: cc.Scene = cc.director.getScene();
        if (!scene) {
            return null;
        }
        return scene.getComponentInChildren(HrzPageCurl);
    }
}

// 测试项目入口：按钮点击后播放一次翻页。
// 翻页本体是 HrzPageCurl（挂在 pageNode 上），这里只负责触发。

const {ccclass} = cc._decorator;

import HrzPageCurl from './HrzPageCurl';

@ccclass
export default class GameTs extends cc.Component {

    /** 按钮回调：播放一次翻页。 */
    public testFanYe(): void {
        const scene: cc.Scene = cc.director.getScene();
        const curl: HrzPageCurl = scene.getComponentInChildren(HrzPageCurl);
        if (!curl) {
            console.warn('[GameTs] 场景里没有 HrzPageCurl 组件');
            return;
        }

        curl.play().catch((error: Error): void => {
            console.warn('[GameTs] 翻页播放失败', error);
        });
    }

}

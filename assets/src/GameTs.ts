// 测试项目入口：按钮点击后播放一次翻页。
// 翻页本体是 HrzPageCurl（挂在 pageNode 上），这里只负责触发。

const {ccclass, property} = cc._decorator;

import HrzPageCurl from './HrzPageCurl';

@ccclass
export default class GameTs extends cc.Component {
    @property(HrzPageCurl)
    zuoPageCurl: HrzPageCurl = null!;
    @property(HrzPageCurl)
    youPageCurl: HrzPageCurl = null!;


    /** 按钮回调：播放一次翻页。 */
    public testFanYe(): void {
        this.zuoPageCurl.node.active = true;
        this.zuoPageCurl.play().then(()=>{
            console.log('[GameTs] 翻页播放成功1');
            this.zuoPageCurl.node.active = false;
        }).catch((error: Error): void => {
            console.warn('[GameTs] 翻页播放失败1', error);
        });
    }


    public testFanYe_you() {
        this.youPageCurl.node.active = true;
        this.youPageCurl.play().then(()=>{
            console.log('[GameTs] 翻页播放成功2');
            this.youPageCurl.node.active = false;
        }).catch((error: Error): void => {
            console.warn('[GameTs] 翻页播放失败2', error);
        });
    }
}

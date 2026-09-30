import HrzPageCurl from './HrzPageCurl';

const { ccclass, property } = cc._decorator;


/** 为 demo 准备独立的真实页面，按钮只负责触发翻页。 */
@ccclass
export default class GameTs extends cc.Component {
    @property(HrzPageCurl)
    public zuoPageCurl: HrzPageCurl | null = null;
    @property(cc.Node)
    public ye1: cc.Node = null!;
    @property(cc.Node)
    public ye2: cc.Node = null!;

    /** 按钮回调：从右页向左翻。 */
    public testFanYe(): void {
        this._play(this.zuoPageCurl, {front: this.ye1, back: this.ye2}, false);
    }

    /** 按钮回调：从左页向右翻。 */
    public testFanYe_you(): void {
        this._play(this.zuoPageCurl, {front: this.ye2, back: this.ye1}, true);
    }

    

    /** 忽略本页已翻过的重复点击，其余并发由翻页组件处理。 */
    private _play(curl: HrzPageCurl | null, pages: { front: cc.Node; back: cc.Node } | null, turnRight: boolean): void {
        if (!curl || !pages || !pages.front?.active) {
            return;
        }
        curl.node.active = true;
        curl.play(pages.front, pages.back, turnRight).catch((error: Error): void => {
            console.warn('[GameTs] 翻页失败', error);
        });
    }
}

// 一个支持中止信号的信号量实现，用于控制并发任务数量
export class Semaphore {
    private tasks: { task: () => Promise<any>; resolve: (value: any) => void; reject: (reason?: any) => void; signal?: AbortSignal }[] = [];
    private count: number;

    constructor(count: number) {
        this.count = count;
    }

    private schedule() {
        if (this.tasks.length > 0 && this.count > 0) {
            this.count--;
            const { task, resolve, reject } = this.tasks.shift()!;
            
            task().then(resolve).catch(reject).finally(() => {
                this.count++;
                this.schedule();
            });
        }
    }

    // [FEAT] 增强 run 方法以支持 AbortSignal，实现任务在排队阶段即可被取消
    public run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new DOMException('Aborted', 'AbortError'));
            }

            const taskEntry = { task, resolve, reject, signal };

            const abortListener = () => {
                const index = this.tasks.indexOf(taskEntry);
                if (index > -1) {
                    this.tasks.splice(index, 1);
                    reject(new DOMException('Aborted', 'AbortError'));
                }
            };

            signal?.addEventListener('abort', abortListener);

            this.tasks.push(taskEntry);
            this.schedule();
        });
    }
}
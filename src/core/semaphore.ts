// --- START OF FILE src/core/semaphore.ts ---

export class Semaphore {
    private tasks: (() => Promise<any>)[] = [];
    private count: number;

    constructor(count: number) {
        this.count = count;
    }

    private schedule() {
        if (this.tasks.length > 0 && this.count > 0) {
            this.count--;
            const next = this.tasks.shift();
            if (next) {
                next().finally(() => {
                    this.count++;
                    this.schedule();
                });
            }
        }
    }

    public run<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.tasks.push(() => task().then(resolve).catch(reject));
            this.schedule();
        });
    }
}
// --- END OF FILE src/core/semaphore.ts ---
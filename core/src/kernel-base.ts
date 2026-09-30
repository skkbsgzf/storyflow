// kernel-base.ts —— kernel 拆分面的共享底座：KernelError（各 kernel-*.ts 与 kernel.ts 共用，避免运行时环）。

export class KernelError extends Error {
  constructor(public code: string, public http: number, message: string) {
    super(message);
  }
}

/**
 * 哈希面抽象（FS1 §六 D7：node:crypto 属宿主面，R7-2 起入册）。
 *
 * 为什么是**同步**接口：ids.ts::sha12 的调用点全在确定性管线里（artifact 指纹 / 输入指纹 /
 * 快照键），改成异步要翻掉整条调用链。Node 适配器用 node:crypto 的 sha1（与旧实现逐字节
 * 等价）；浏览器宿主将来需要自带一份纯 JS 的同步 sha1（WebCrypto 的 digest 是异步的，
 * 不能就地替换——R6 回执 N9 已记）。
 */
export interface IHasher {
  /** 十六进制小写 sha1 摘要（全 40 位；ids.ts::sha12 自行截前 12 位）。 */
  sha1Hex(text: string): string;
}

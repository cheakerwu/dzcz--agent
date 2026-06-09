/**
 * 文件读取工具函数（浏览器端）
 * 
 * 提供浏览器端文件读取相关的辅助函数
 */

/**
 * 读取文件为 Data URL（base64）
 * 
 * @param file 文件对象
 * @returns Promise<string> Data URL
 * 
 * @example
 * const dataUrl = await readFileAsDataURL(file);
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

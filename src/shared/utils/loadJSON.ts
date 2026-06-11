export async function loadJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(`学习数据加载失败：${url}。请刷新页面或检查部署静态资源。`);
  }
}

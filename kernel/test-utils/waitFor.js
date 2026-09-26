// 冻结接口（规格 §10）：waitFor(socket, event, timeout)；waitForMatching(socket, event, predicate, timeout)
// resolve 载荷；超时 reject（消息含事件名）；resolve / reject 后都移除监听器
export function waitFor(socket, event, timeout = 5000) {
  return waitForMatching(socket, event, () => true, timeout);
}

export function waitForMatching(socket, event, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout(${timeout}ms) waiting for ${event}`));
    }, timeout);
    function onEvent(data) {
      let matched = false;
      try {
        matched = predicate(data);
      } catch {
        matched = false; // predicate 抛异常视为不匹配，继续监听
      }
      if (!matched) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(data);
    }
    socket.on(event, onEvent);
  });
}

(() => {
  const base = "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app";
  document.querySelectorAll("a[data-app]").forEach(link => {
    link.href = base + link.dataset.app;
  });
})();

(() => {
  let localDataPromise;

  function loadLocalData() {
    if (!localDataPromise) {
      localDataPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('./dados-locais.js', document.baseURI).href;
        script.onload = () => {
          const data = globalThis.__BANNER_LOCAL_DATA__;
          if (Array.isArray(data?.notes) && data.images) resolve(data);
          else reject(new Error('Os recursos locais do editor estao invalidos.'));
        };
        script.onerror = () => reject(new Error('Nao foi possivel carregar dados-locais.js. Mantenha esse arquivo na pasta Banner.'));
        document.head.appendChild(script);
      });
    }
    return localDataPromise;
  }

  globalThis.BannerResources = {
    async loadNotes(path) {
      if (location.protocol === 'file:') return (await loadLocalData()).notes;
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    async imageSource(path) {
      const url = new URL(encodeURI(path), document.baseURI);
      if (location.protocol !== 'file:' || url.protocol !== 'file:') return url.href;
      const key = decodeURIComponent(url.pathname.slice(new URL('.', document.baseURI).pathname.length));
      const source = (await loadLocalData()).images[key];
      if (!source) throw new Error(`Imagem local ausente: ${path}`);
      return source;
    },
  };
})();

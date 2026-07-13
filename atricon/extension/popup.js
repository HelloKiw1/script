const AVALIA_HOME = 'https://avalia.atricon.org.br/';

document.getElementById('openPanel').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('painel.html') });
  window.close();
});

document.getElementById('openAtricon').addEventListener('click', async () => {
  await chrome.tabs.create({ url: AVALIA_HOME });
  window.close();
});

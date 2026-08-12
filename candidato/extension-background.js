function openCandidatron() {
  chrome.tabs.create({ url: chrome.runtime.getURL('candidato/candidato.html') });
}

chrome.runtime.onInstalled.addListener(openCandidatron);
chrome.action.onClicked.addListener(openCandidatron);

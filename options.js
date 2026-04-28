document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['staticEpId', 'originNumber', 'clientId', 'clientSecret']);
  if (data.clientId) document.getElementById('clientId').value = data.clientId;
  if (data.clientSecret) document.getElementById('clientSecret').value = data.clientSecret;
  if (data.staticEpId) document.getElementById('epId').value = data.staticEpId;
  if (data.originNumber) document.getElementById('origin').value = data.originNumber;
});

document.getElementById('save').addEventListener('click', async () => {
  const settings = {
    clientId: document.getElementById('clientId').value,
    clientSecret: document.getElementById('clientSecret').value,
    staticEpId: document.getElementById('epId').value,
    originNumber: document.getElementById('origin').value
  };

  await chrome.storage.local.set(settings);

  const status = document.getElementById('status');
  status.textContent = "Settings saved!";
  setTimeout(() => { status.textContent = ""; }, 2000);
});
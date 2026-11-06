import { api } from './api';

let loading: Promise<void> | undefined;
function loadPicker() {
  if (!loading)
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onload = () =>
        gapi.load('picker', {
          callback: resolve,
          onerror: () => reject(new Error('Google folder chooser could not load.')),
          timeout: 15000,
          ontimeout: () => reject(new Error('Google folder chooser timed out.')),
        });
      script.onerror = () =>
        reject(new Error('Could not reach Google. Check your connection and try again.'));
      document.head.appendChild(script);
    }).catch((error) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

export async function chooseDriveFolder(): Promise<string | null> {
  await loadPicker();
  // Only a short-lived access token reaches Google's browser picker. Refresh tokens stay on Render.
  const credentials = await api<{ accessToken: string; apiKey: string; projectNumber: string }>(
    '/drive/picker',
    { method: 'POST', body: '{}' },
  );
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    const picker = new google.picker.PickerBuilder()
      .setTitle('Choose a folder for new Drivebase databases')
      .setAppId(credentials.projectNumber)
      .setDeveloperKey(credentials.apiKey)
      .setOAuthToken(credentials.accessToken)
      .setOrigin(window.location.origin)
      .addView(view)
      .setCallback((data: google.picker.ResponseObject) => {
        if (data.action === google.picker.Action.PICKED) {
          picker.setVisible(false);
          resolve(data.docs?.[0]?.id || null);
        } else if (data.action === google.picker.Action.CANCEL) {
          picker.setVisible(false);
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

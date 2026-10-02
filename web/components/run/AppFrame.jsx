export const runningAppUrl = run => run.devServer && !run.devServer.stoppedAt ? run.devServer.url : null;

export function AppFrame({ url }) {
  return <iframe className="live-app" src={url} title="Running app" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write"/>;
}

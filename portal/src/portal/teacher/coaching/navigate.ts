/**
 * bd-oawrlt — send the page to a freshly signed report link (Download). Its own module so a test can stand in for the
 * browser's navigation, which jsdom does not implement.
 */
export function goTo(url: string): void {
  window.location.href = url;
}

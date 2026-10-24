import './style.css'
import { mountDebugOverlay, parseDebugFlag } from './ui/debug'
import { installKidProofing } from './ui/shell'

installKidProofing()

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Missing #app root element')

app.innerHTML = `
  <main class="hello">
    <div class="bubbles" aria-hidden="true">
      <span class="bubble bubble--a"></span>
      <span class="bubble bubble--b"></span>
      <span class="bubble bubble--c"></span>
    </div>
    <h1 class="hello__title">Hello!</h1>
    <p class="hello__note">Pop Pals · platform proof</p>
  </main>
`

// No game code in M0. The overlay skeleton is built now because it is the only
// debugging channel we can rely on once the app is installed on the tablet.
if (parseDebugFlag(window.location.search)) {
  mountDebugOverlay(document.body)
}

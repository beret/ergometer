import {colorize} from './colors.js'
import {getIcon} from './icon.js'
import {Model} from './model.js'
import {revive} from './reviver.js'
import {Duration, Time, sleep} from './time.js'
import {makeExponential, maxBy} from './util.js'

function now() {
  const sinceEpoch = Duration.milliseconds(Date.now()).round('deciseconds')
  const zone = Duration.minutes(-new Date().getTimezoneOffset())
  return new Time(sinceEpoch, zone)
}

function setIcon(data) {
  return browser.browserAction.setIcon({
    imageData: getIcon(16, data, {asImageData: true}),
  })
}

const minCloseAfter = Duration.seconds(0.5)

async function flash(closeAfter = minCloseAfter) {
  const {id} = await browser.windows.create({
    url: 'flash.html',
    type: 'popup',
    state: 'fullscreen',
  })
  await sleep(closeAfter)
  try {
    await browser.windows.remove(id)
  } catch (e) {
    if (e.message != `No window with id: ${id}.`) {
      throw e
    }
  }
}

let wasMonitored = true
let lastFlashUnmonitored

function maybeFlashUnmonitored(time, monitored, {session, rest}) {
  if (!monitored) {
    if (wasMonitored) {
      lastFlashUnmonitored = time.minus(rest.target)
    }
    const openAfter = session.target.plus(rest.target)
    if (time.minus(lastFlashUnmonitored).greaterEqual(openAfter)) {
      flash()
      lastFlashUnmonitored = time
    }
  }
  wasMonitored = monitored
}

let lastFlashAttained = new Time(-Infinity)

function maybeFlashAttained(time, monitored, metrics) {
  const exhaustibleMetrics = Object.values(metrics).filter(
    m => m.name != 'rest',
  )
  if (
    !monitored ||
    metrics.rest.ratio ||
    !exhaustibleMetrics.some(m => m.attained)
  ) {
    return
  }
  const exhaustionOf = m => m.ratio
  const m = maxBy(exhaustibleMetrics, exhaustionOf)
  const exhaustion = exhaustionOf(m)
  const limit = 16 / 15

  const interpolate = (start, end) =>
    Duration.seconds(
      makeExponential(1, limit, start.seconds, end.seconds)(exhaustion),
    )

  const minOpenAfter = model.idleDelay.plus({seconds: 5})
  const openAfter = interpolate(
    m.target.dividedByScalar(60).clampLow(minOpenAfter),
    minOpenAfter,
  ).clampLow(minOpenAfter)
  const maxCloseAfter = Duration.seconds(10)
  const closeAfter = interpolate(minCloseAfter, maxCloseAfter).clampHigh(
    maxCloseAfter,
  )
  if (time.minus(lastFlashAttained).greaterEqual(openAfter)) {
    flash(closeAfter)
    lastFlashAttained = time
  }
}

let ticking

function tick() {
  if (ticking) {
    return
  }
  ticking = true
  sleep.cancel(tick)
  if (!model.state) {
    return
  }

  const time = now()
  const {monitored, firstWeek, dailyValues} = model.state
  const metrics = colorize(model.getMetrics(time))
  const advisedMetrics = Object.values(metrics).filter(m => m.advised)
  const iconData = {monitored, metrics: advisedMetrics}
  setIcon(iconData)
  maybeFlashAttained(time, monitored, metrics)
  maybeFlashUnmonitored(time, monitored, metrics)
  send('flash', iconData)
  send('details', {monitored, metrics, firstWeek, dailyValues})

  const t = model.periodsSinceActive(time)
  if (0.8 <= t && t < 1) {
    model.update({time, idleState: 'active'})
  }

  if (!metrics.rest.attained) {
    scheduleTick()
  }
  ticking = false
}

async function scheduleTick() {
  if (await sleep(Duration.seconds(1), tick)) {
    return
  }
  tick()
}

async function load() {
  const results = await browser.storage.local.get('state')
  return revive(results.state)
}

let storeCount = 0
let meanStoreLatency = 0
let maxStoreLatency = 0
const model = new Model(now(), load(), {
  verbose: true,
  idleDelay: Duration.seconds(15),
  keepActivePeriod: Duration.seconds(25),
  async onUpdate() {
    tick()
    const start = performance.now()
    await browser.storage.local.set({state: JSON.stringify(model.state)})
    const latency = performance.now() - start
    storeCount++
    meanStoreLatency =
      (meanStoreLatency * (storeCount - 1) + latency) / storeCount
    maxStoreLatency = Math.max(maxStoreLatency, latency)
    if (!(storeCount % 1000)) {
      console.log({meanStoreLatency, maxStoreLatency})
    }
  },
  onPush() {},
})
model.loaded.then(tick)

function update(event) {
  event.time = now()
  model.update(event)
}

const ports = new Map()
browser.runtime.onConnect.addListener(port => {
  ports.set(port.name, port)
  port.onMessage.addListener(async event => update(await revive(event)))
  port.onDisconnect.addListener(() => ports.delete(port.name))
  tick()
})

function send(name, message) {
  if (!ports.has(name)) {
    return
  }
  ports.get(name).postMessage(JSON.stringify(message))
}

const idleStateChanged = idleState => update({idleState})
browser.idle.setDetectionInterval(model.idleDelay.seconds)
browser.idle.onStateChanged.addListener(idleStateChanged)
browser.idle.queryState(model.idleDelay.seconds).then(idleStateChanged)

let errorCount = 0
function handleError(error) {
  errorCount++
  browser.browserAction.setBadgeText({text: '' + errorCount})
  browser.browserAction.setBadgeBackgroundColor({color: 'red'})
  throw error
}

addEventListener('error', ({error}) => handleError(error))
addEventListener('unhandledrejection', ({reason}) => handleError(reason))

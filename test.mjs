import {setConnector} from './model.mjs'

const tests = []

export function test(f) {
    tests.push(f)
}

export async function run(getConnector, ...modulePaths) {
    setConnector(getConnector({temporary: true}))
    await Promise.all(['./model.test.mjs', ...modulePaths].map(m => import(m)))
    await Promise.all(tests.map(f => f()))
    console.log(`${tests.length} pass`)
}

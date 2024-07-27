import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { Socket } from 'net'

if (!existsSync(new URL('used_config.json', import.meta.url))) writeFileSync(new URL('used_config.json', import.meta.url), '{}')
if (!existsSync(new URL('configs', import.meta.url))) mkdirSync(new URL('configs', import.meta.url))

async function main() {
    const [command, ...args] = process.argv.slice(2)
    let confg = null
    if (command == 'use') {
        await writeFile(new URL('used_config.json', import.meta.url), await readFile(new URL(`configs/${args.join(' ').trim()}.json`, import.meta.url)))
    }
    try {
        confg = JSON.parse(await readFile(new URL('used_config.json', import.meta.url)) || '{}')
        if (!confg.hostname || !confg.port) return console.log(`config incorrect!\nexample: ${JSON.stringify({ hostname: '127.0.0.1', port: 4732 })}`)
    } catch (error) {
        return console.log(`config incorrect!\nexample: ${JSON.stringify({ hostname: '127.0.0.1', port: 4732 })}`)
    }
    const socket = new Socket()
    await new Promise(r => socket.connect({ host: confg.hostname, port: confg.port }, r))
    let res = null
    switch (command) {
        case 'apply':
            const serviceConf = await readFile(args.join(' ').trim())
            socket.write(JSON.stringify({ apply: JSON.parse(serviceConf) }))
            res = await new Promise(r => socket.once('data', r))
            console.log(res.toString())
            break
        case 'status':
            socket.write(JSON.stringify({ status: { name: args[0] } }))
            res = await new Promise(r => socket.once('data', r))
            console.log(res.toString())
            break
        case 'start':
            socket.write(JSON.stringify({ start: { name: args[0] } }))
            res = await new Promise(r => socket.once('data', r))
            console.log(res.toString())
            break
        case 'restart':
            socket.write(JSON.stringify({ restart: { name: args[0] } }))
            res = await new Promise(r => socket.once('data', r))
            console.log(res.toString())
            break
        case 'stop':
            socket.write(JSON.stringify({ stop: { name: args[0] } }))
            res = await new Promise(r => socket.once('data', r))
            console.log(res.toString())
            break
        case 'logs':
            socket.write(JSON.stringify({ logs: { name: args[0] } }))
            res = (await new Promise(r => socket.once('data', r))).toString()
            if (args[1] == 'raw' || res.startsWith('invalid, get logs')) {
                console.log(res)
            } else {
                res.split('\n').filter(s => s).forEach((log) => {
                    const [date, l] = JSON.parse(log)
                    console.log(`[${date}]:\n${l}`)
                })
            }
    }
    await new Promise(r => socket.end(r))
}
main()


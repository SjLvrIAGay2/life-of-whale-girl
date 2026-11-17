// Read-only hkey from lumingfei004/dph-heybox (MIT). See vendor/HEYBOX-LICENSE.txt.
import crypto from 'node:crypto'

export const ALPHABET = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89'

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

// GF(2^8) 风格的双倍运算：与前端 w3 函数等价
const double = (v) => ((v << 1) ^ (v & 128 ? 27 : 0)) & 255
const three = (v) => double(v) ^ v
const nine = (v) => three(double(v))
const eleven = (v) => nine(three(double(v)))
const thirteen = (v) => eleven(v) ^ nine(v) ^ three(v)

// 4x4 混合：与前端 Vwe 函数的前半段等价
function mix4(a, b, c, d) {
  return [
    thirteen(a) ^ eleven(b) ^ nine(c) ^ three(d),
    three(a) ^ thirteen(b) ^ eleven(c) ^ nine(d),
    nine(a) ^ three(b) ^ thirteen(c) ^ eleven(d),
    eleven(a) ^ nine(b) ^ three(c) ^ thirteen(d),
  ]
}

const mapChars = (value, alphabet) => {
  let out = ''
  for (const ch of value) out += alphabet[ch.charCodeAt(0) % alphabet.length]
  return out
}

/** 按路径 + 时间戳 + nonce 计算 hkey（7 字符：5 位前缀 + 2 位校验和） */
export function hkey(path, timestamp, nonce) {
  const norm = '/' + String(path).split('/').filter(Boolean).join('/') + '/'
  const comps = [
    mapChars(String(timestamp), ALPHABET.slice(0, -2)),
    mapChars(norm, ALPHABET),
    mapChars(nonce, ALPHABET),
  ]

  const max = Math.max(...comps.map((c) => c.length))
  let interleaved = ''
  for (let k = 0; k < max; k += 1) {
    for (const c of comps) if (k < c.length) interleaved += c[k]
  }

  const digest = md5(interleaved.slice(0, 20))
  // ⚠️ 这里是关键：取尾部 6 个字节，全部参与校验和
  const tail = [...digest.slice(-6)].map((c) => c.charCodeAt(0))
  const mixed = [...mix4(tail[0], tail[1], tail[2], tail[3]), tail[4], tail[5]]
  const checksum = String(mixed.reduce((a, b) => a + b, 0) % 100).padStart(2, '0')
  const prefix = mapChars(digest.slice(0, 5), ALPHABET.slice(0, -4))
  return prefix + checksum
}


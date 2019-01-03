import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const database = admin.firestore()
const settings = { timestampsInSnapshots: true }
database.settings(settings)

export const outbreak = functions.firestore
  .document('rooms/{roomid}/battles/{battleid}')
  .onCreate((snap, context) => {
    const roomid = context.params.roomid
    const battleid = context.params.battleid

    const battle = new Battle(database, roomid, battleid)
    // じゃんけん判定
    return battle.waitBattleEnd().then(closed => {
      battle.close()
      if (!closed) {
        // 時間切れ
        return battle.announce(
          '一定時間内にメンバーが集まりませんでしたので、じゃんけんを終了します'
        )
      } else {
        // 判定
        return battle.judge()
      }
    })
  })

class Battle {
  private ROCK = 'rock'
  private SCISSOR = 'scissor'
  private PAPER = 'paper'

  private HAND_MAP = {
    rock: 'グー',
    scissor: 'チョキ',
    paper: 'パー'
  }

  constructor(
    private db: admin.firestore.Firestore,
    private roomid: string,
    private battleid: string
  ) {
    // 開始通知
    this.announce('じゃんけんが開始されました')
  }

  public async waitBattleEnd(): Promise<boolean> {
    console.log('待ち開始')
    // 手入力待ち
    const looplimit = 3
    for (let index = 0; index < looplimit; index++) {
      const ended = await this.sleep(10, () => {
        return this.db
          .collection('rooms')
          .doc(this.roomid)
          .collection('battles')
          .doc(this.battleid)
          .collection('hands')
          .get()
          .then(snapshot => {
            // 手数判定
            console.log('hand size', snapshot.size)
            return snapshot.size > 1
          })
      })
      if (ended) {
        console.log('待ち終了', ended)
        return true
      } else if (index < looplimit - 1) {
        console.log('延長')
        this.announce('メンバーが集まりませんでしたので延長します')
      }
    }

    return false
  }

  public judge(): Promise<void> {
    return this.db
      .collection('rooms')
      .doc(this.roomid)
      .collection('battles')
      .doc(this.battleid)
      .collection('hands')
      .get()
      .then(async snapshot => {
        const handsData: Map<string, admin.firestore.DocumentData[]> = new Map([
          [this.ROCK, []],
          [this.SCISSOR, []],
          [this.PAPER, []]
        ])

        snapshot.forEach(docSnapshot => {
          const data = docSnapshot.data()
          handsData.get(data.hand).push(data)
        })

        console.log('手判定', handsData)
        const rockCount = handsData.get(this.ROCK).length
        const scissorCount = handsData.get(this.SCISSOR).length
        const paperCount = handsData.get(this.PAPER).length

        let handsUniqueCount = 0
        handsUniqueCount += rockCount > 0 ? 1 : 0
        handsUniqueCount += scissorCount > 0 ? 1 : 0
        handsUniqueCount += paperCount > 0 ? 1 : 0

        switch (handsUniqueCount) {
          case 1:
          case 3:
            // 手が3種類or1種類であればあいこ
            await this.announce('じゃんけん結果: あいこ')
            break
          case 2:
            // 手が2種類の場合、勝ち手を告知
            let winHandKind: string
            if (rockCount === 0) {
              // チョキの勝ち
              winHandKind = this.SCISSOR
            } else if (scissorCount === 0) {
              // パーの勝ち
              winHandKind = this.PAPER
            } else if (paperCount === 0) {
              // グーの勝ち
              winHandKind = this.ROCK
            }
            const winners: string[] = []
            handsData.get(winHandKind).forEach(handData => {
              winners.push(handData.author)
            })

            await this.announce(
              'じゃんけん結果: ' + this.HAND_MAP[winHandKind] + 'の勝ち'
            )

            await this.announce('勝者: ' + winners.join(', '))

            break
          default:
            break
        }

        // 全員の手を開示
        Object.keys(this.HAND_MAP).forEach(async handKey => {
          const authors: string[] = []
          handsData.get(handKey).forEach(handData => {
            authors.push(handData.author)
          })

          await this.announce(
            this.HAND_MAP[handKey] + 'のひと: ' + authors.join(', ')
          )
        })
      })
  }

  public announce(messagebody: string): Promise<void> {
    return this.db
      .collection('rooms')
      .doc(this.roomid)
      .collection('messages')
      .add({
        uid: 'judge',
        author: 'ジャッジ',
        icon: 'judge',
        body: messagebody,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      })
      .then(() => {
        return
      })
  }

  public close() {
    // バトル終了させる
    this.db
      .collection('rooms')
      .doc(this.roomid)
      .collection('battles')
      .doc(this.battleid)
      .update({
        state: 'closed'
      })
  }

  private sleep(waitSeconds: number, someFunction: () => any): Promise<any> {
    return new Promise(resolve => {
      setTimeout(() => {
        return resolve(someFunction())
      }, waitSeconds * 1000)
    })
  }
}

export const pick = functions.firestore
  .document('rooms/{roomid}/battles/{battleid}/hands/${handid}')
  .onCreate((snap, context) => {
    const roomid = context.params.roomid
    const battleid = context.params.battleid

    const battle = new Battle(database, roomid, battleid)

    const data = snap.data()

    battle.announce(data.author + 'が手を入力しました')
  })

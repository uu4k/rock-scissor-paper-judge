import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

export const outbreak = functions.firestore
  .document('rooms/{roomid}/battles/{battleid}')
  .onCreate((snap, context) => {
    admin.initializeApp()

    const db = admin.firestore()

    const roomid = context.params.roomid
    const battleid = context.params.battleid

    const battle = new Battle(db, roomid, battleid)
    // じゃんけん判定
    battle.waitBattleEnd().then(closed => {
      if (!closed) {
        // 時間切れ
        battle.announce(
          '一定時間内にメンバーが集まりませんでしたので、じゃんけんを終了します'
        )
      } else {
        // 判定
        battle.judge()
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
    // 手入力待ち
    const looplimit = 3
    for (let index = 0; index < looplimit; index++) {
      const ended = await this.sleep(10, () => {
        this.db
          .collection('rooms')
          .doc(this.roomid)
          .collection('battles')
          .doc(this.battleid)
          .collection('hands')
          .get()
          .then(snapshot => {
            // 手数判定
            return snapshot.size > 1
          })
      })
      if (ended) {
        return true
      } else if (index < looplimit - 1) {
        this.announce('メンバーが集まりませんでしたので延長します')
      }
    }

    return false
  }

  public judge() {
    this.db
      .collection('rooms')
      .doc(this.roomid)
      .collection('battles')
      .doc(this.battleid)
      .collection('hands')
      .get()
      .then(snapshot => {
        const handsData: Map<string, admin.firestore.DocumentData[]> = new Map([
          [this.ROCK, []],
          [this.SCISSOR, []],
          [this.PAPER, []]
        ])

        snapshot.forEach(docSnapshot => {
          const data = docSnapshot.data()
          handsData.get(data.hand).push(data)
        })

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
            this.announce('じゃんけん結果: あいこ')
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
            this.announce(
              'じゃんけん結果: ' + this.HAND_MAP[winHandKind] + 'の勝ち'
            )

            const winners: string[] = []
            handsData.get(winHandKind).forEach(handData => {
              winners.push(handData.author)
            })

            this.announce('勝者: ' + winners.join(', '))

            break
          default:
            break
        }

        // 全員の手を開示
        Object.keys(this.HAND_MAP).forEach(handKey => {
          const authors: string[] = []
          handsData.get(handKey).forEach(handData => {
            authors.push(handData.author)
          })

          this.announce(
            this.HAND_MAP[handKey] + 'のひと: ' + authors.join(', ')
          )
        })
      })
  }

  public announce(messagebody: string): void {
    this.db
      .collection('rooms')
      .doc(this.roomid)
      .collection('messages')
      .add({
        uid: 'judge',
        author: 'ジャッジ',
        body: messagebody,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      })
  }

  private sleep(waitSeconds: number, someFunction: () => void) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(someFunction)
      }, waitSeconds * 1000)
    })
  }
}

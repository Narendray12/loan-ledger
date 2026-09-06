// Development only: fills the local mirror with sample people and loans so every screen can be
// looked at without a backend. Never queued for sync. Triggered by /?seed=1 in dev builds.
import { db } from './db'
import { generateCards } from './cards'
import { addMonths } from './cards'
import { nowISO, todayISO, uuid } from './format'
import type { Installment, Loan, Person } from './types'

export async function devSeed(): Promise<void> {
  if (!import.meta.env.DEV) return
  if ((await db.people.count()) > 0) return
  const now = nowISO()
  const today = todayISO()
  const month = today.slice(0, 7)
  const person = (
    full_name: string,
    phone: string,
    address: string,
    occupation: string,
  ): Person => ({
    id: uuid(),
    full_name,
    phone,
    address,
    occupation,
    notes: null,
    updated_at: now,
    deleted_at: null,
  })
  const people = [
    person('Sunita Devi', '+919812345670', 'Ward 2, Station Road, Sitapur 261001', 'Tailoring'),
    person('Vikas Yadav', '+919812345671', 'Village Rampur, Sitapur', 'Farmer'),
    person(
      'Ramesh Kumar',
      '+919876543210',
      'H.No 12, Ward 4, Rampur Road, Sitapur 261001',
      'Shop owner',
    ),
    person('Mohd. Irfan', '+919812345673', 'Main Bazaar, Sitapur', 'Mechanic'),
    person('Priya Sharma', '+919812345674', 'Civil Lines, Sitapur', 'Teacher'),
    person('Anita Verma', '+919812345675', 'Ward 7, Sitapur', 'Homemaker'),
  ]
  // [months since the first due date, tenure, installment, paid count, late months]
  const spec: [number, number, number, number, number[]][] = [
    [4, 12, 3500, 3, [3, 4]],
    [2, 12, 10000, 2, [2]],
    [5, 12, 5000, 5, []],
    [3, 12, 2000, 3, []],
    [1, 12, 5000, 1, []],
    [4, 12, 3000, 4, []],
  ]
  const loans: Loan[] = []
  const cards: Installment[] = []
  people.forEach((p, i) => {
    const [ago, tenure, inst, paidCount, late] = spec[i]!
    const firstDue = addMonths(`${month}-10`, -ago)
    const loan: Loan = {
      id: uuid(),
      loan_no: String(31 + i * 2),
      borrower_id: p.id,
      co_borrower_id: null,
      amount: inst * tenure,
      loan_date: addMonths(firstDue, -1),
      tenure_months: tenure,
      installment_amount: inst,
      total_repayment: inst * tenure,
      first_due_date: firstDue,
      business_name: i === 2 ? 'Kumar General Store' : null,
      business_address: i === 2 ? 'Main Bazaar, near bus stand, Sitapur' : null,
      business_mobile: null,
      monthly_income: i === 2 ? 40000 : null,
      ref1_name: 'Dinesh Verma',
      ref1_phone: '+919988776655',
      ref1_address: 'Ward 2, Station Road, Sitapur',
      ref2_name: 'Suresh Gupta',
      ref2_phone: '+919988776656',
      ref2_address: null,
      status: 'active',
      settled_on: null,
      notes: null,
      updated_at: now,
      deleted_at: null,
    }
    loans.push(loan)
    for (const c of generateCards(loan, now)) {
      if (c.no <= paidCount && !late.includes(c.no)) {
        c.paid_amount = c.amount_due
        c.paid_on = addMonths(c.due_date, 0).replace(
          /-\d{2}$/,
          `-${String(8 + (c.no % 5)).padStart(2, '0')}`,
        )
        c.paid_mode = 'cash'
      }
      cards.push(c)
    }
  })
  await db.transaction(
    'rw',
    db.people,
    db.loans,
    db.installments,
    db.id_proofs,
    db.phone_verifications,
    async () => {
      await db.people.bulkPut(people)
      await db.loans.bulkPut(loans)
      await db.installments.bulkPut(cards)
      await db.id_proofs.bulkPut([
        {
          id: uuid(),
          person_id: people[2]!.id,
          id_type: 'aadhaar',
          id_last4: '5246',
          updated_at: now,
          deleted_at: null,
        },
        {
          id: uuid(),
          person_id: people[2]!.id,
          id_type: 'pan',
          id_last4: '234F',
          updated_at: now,
          deleted_at: null,
        },
        {
          id: uuid(),
          person_id: people[0]!.id,
          id_type: 'voter_id',
          id_last4: '1987',
          updated_at: now,
          deleted_at: null,
        },
      ])
      await db.phone_verifications.put({
        phone: people[2]!.phone,
        verified_at: now,
        person_id: people[2]!.id,
        proof: 'dev',
        updated_at: now,
      })
    },
  )
}

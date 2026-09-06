import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { db } from '../lib/db'
import { errorMessage } from '../lib/format'
import { personSchema, type PersonForm, type PersonValues } from '../lib/schemas'
import { savePerson } from '../lib/save'
import { fromE164 } from '../lib/validators'
import { BottomBar, Button, Field, Input, Notice, Page, Textarea, TopBar } from '../components/ui'
import { PersonFields } from '../components/fields'

export function PersonEdit() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [initial, setInitial] = useState<PersonForm | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const p = await db.people.get(id)
      if (!p) return navigate('/', { replace: true })
      const proofs = await db.id_proofs
        .where('person_id')
        .equals(id)
        .filter((x) => !x.deleted_at)
        .toArray()
      setInitial({
        id: p.id,
        full_name: p.full_name,
        phone: fromE164(p.phone),
        address: p.address ?? '',
        occupation: p.occupation ?? '',
        notes: p.notes ?? '',
        id_proofs: proofs.map((x) => ({
          id: x.id,
          id_type: x.id_type,
          id_number: '',
          id_last4: x.id_last4 ?? '',
        })),
      })
    })()
  }, [id, navigate])

  if (!initial) return <TopBar title="Edit person" close={() => navigate(`/people/${id}`)} />
  return (
    <Form
      initial={initial}
      error={error}
      onSave={async (v) => {
        try {
          await savePerson(v)
          navigate(`/people/${id}`, { replace: true })
        } catch (e) {
          setError(errorMessage(e))
        }
      }}
    />
  )
}

function Form({
  initial,
  error,
  onSave,
}: {
  initial: PersonForm
  error: string | null
  onSave: (v: PersonValues) => Promise<void>
}) {
  const navigate = useNavigate()
  const form = useForm<PersonForm, unknown, PersonValues>({
    resolver: zodResolver(personSchema),
    defaultValues: initial,
    mode: 'onBlur',
  })
  const [invalid, setInvalid] = useState(false)
  return (
    <FormProvider {...form}>
      <TopBar title="Edit person" close={() => navigate(`/people/${initial.id}`)} />
      <Page>
        <form
          onSubmit={form.handleSubmit(
            (v) => {
              setInvalid(false)
              return onSave(v)
            },
            () => setInvalid(true),
          )}
          noValidate
          className="space-y-3.5"
          id="person-edit"
        >
          <PersonFields />
          <Field label="Occupation">
            <Input {...form.register('occupation')} />
          </Field>
          <Field label="Notes">
            <Textarea {...form.register('notes')} />
          </Field>
          {invalid && (
            <Notice tone="error">Some fields need attention, they are marked above.</Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </form>
      </Page>
      <BottomBar>
        <Button
          type="submit"
          form="person-edit"
          className="flex-1"
          disabled={form.formState.isSubmitting}
        >
          Save changes
        </Button>
      </BottomBar>
    </FormProvider>
  )
}

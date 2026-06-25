import { redirect } from 'next/navigation'

export const metadata = { title: 'BookInsight' }

export default function TargetPage() {
  redirect('/')
}

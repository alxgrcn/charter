import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'
import { createServiceClient } from '../../../lib/supabase'
import { auditLog } from '../../../lib/auditLog'
import type { ReportJSON } from '../../../types/charter'

if (!process.env.RESEND_API_KEY) {
  console.warn('[send-report] RESEND_API_KEY is not set — email sending will fail')
}

const resend = new Resend(process.env.RESEND_API_KEY)

const BodySchema = z.object({
  email: z.string().email(),
  session_id: z.string(),
  report: z.custom<ReportJSON>(),
})

function buildHtml(report: ReportJSON, email: string): string {
  const benefits = report.benefits
    .map(
      (b) => `
      <tr style="border-bottom:1px solid #e4e4e7">
        <td style="padding:10px 0;font-weight:600;color:#18181b">${b.benefit_name}</td>
        <td style="padding:10px 8px;text-align:center;color:${b.qualifies === 'yes' ? '#15803d' : b.qualifies === 'no' ? '#b91c1c' : '#92400e'}">${b.qualifies.toUpperCase()}</td>
        <td style="padding:10px 0;color:#3f3f46;font-size:13px">${Math.round(b.confidence * 100)}%</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0 0 12px;color:#52525b;font-size:13px">${b.reason}</td>
      </tr>`,
    )
    .join('')

  const priorityActions =
    report.priority_actions.length > 0
      ? `<h2 style="color:#18181b;font-size:16px;margin:24px 0 8px">Recommended Next Steps</h2>
         <ol style="padding-left:20px;color:#3f3f46;font-size:14px;line-height:1.6">
           ${report.priority_actions.map((a) => `<li style="margin-bottom:6px">${a}</li>`).join('')}
         </ol>`
      : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;margin:0;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:32px">
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e">
      ${report.crisis_line}
    </div>
    <h1 style="color:#18181b;font-size:22px;margin:0 0 4px">Your Veterans Benefits Report</h1>
    <p style="color:#71717a;font-size:13px;margin:0 0 24px">Generated ${new Date(report.generated_at).toLocaleDateString()}</p>
    <div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#71717a;line-height:1.5">
      ${report.disclaimer}
    </div>
    <h2 style="color:#18181b;font-size:16px;margin:0 0 12px">Benefits Analysis</h2>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid #e4e4e7">
          <th style="text-align:left;padding-bottom:8px;color:#71717a;font-size:12px;font-weight:600">BENEFIT</th>
          <th style="text-align:center;padding-bottom:8px;color:#71717a;font-size:12px;font-weight:600">STATUS</th>
          <th style="text-align:left;padding-bottom:8px;color:#71717a;font-size:12px;font-weight:600">CONFIDENCE</th>
        </tr>
      </thead>
      <tbody>${benefits}</tbody>
    </table>
    ${priorityActions}
    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5">
      This report is educational and designed to help identify possible benefits or next steps. It is not a final eligibility determination. Sent to ${email}.
    </p>
  </div>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { email, session_id, report } = parsed.data

  const from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'

  const { error: sendError } = await resend.emails.send({
    from,
    to: email,
    subject: 'Your Veterans Benefits Report — Charter',
    html: buildHtml(report, email),
  })

  if (sendError) {
    console.error('[send-report] Resend error:', sendError)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  // SERVICE CLIENT: saving email capture to veteran_profiles — trusted server op
  const supabase = createServiceClient()
  await supabase
    .from('veteran_profiles')
    .update({ email } as never)
    .eq('session_id', session_id)

  void auditLog({
    actor_role: 'system',
    action: 'report_emailed',
    meta: { session_id, email_redacted: email.split('@')[1] },
  })

  return NextResponse.json({ ok: true })
}

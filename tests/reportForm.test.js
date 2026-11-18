import { describe, it, expect } from 'vitest'
import { buildReportPayload } from '../src/reportForm.js'

describe('buildReportPayload', () => {
  it('includes task id only when selected', () => {
    const base = {
      reportDate: '2026-11-19',
      playerA: 'Иван',
      playerB: 'Пётр',
      interactionType: 'external',
      description: 'Тест',
      taskId: ''
    }
    expect(buildReportPayload(base)).toMatchObject({
      p_report_date: '2026-11-19',
      p_player_a: 'Иван',
      p_player_b: 'Пётр',
      p_interaction_type: 'external',
      p_description: 'Тест'
    })
    expect(buildReportPayload(base).p_task_id).toBeNull()
    expect(buildReportPayload({ ...base, taskId: 'abc' }).p_task_id).toBe('abc')
  })
})

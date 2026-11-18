// Маппит поля формы в точные имена параметров RPC create_report.
function field(formData, name) {
  if (!formData) return null
  if (typeof formData.get === 'function') {
    const value = formData.get(name)
    return value === null ? null : value
  }
  return formData[name] ?? null
}

export function buildReportPayload(formData, screenshotUrls = []) {
  const taskId = field(formData, 'taskId')
  const urls = (Array.isArray(screenshotUrls) ? screenshotUrls : [screenshotUrls])
    .filter((url) => typeof url === 'string' && url.length > 0)

  return {
    p_report_date: field(formData, 'reportDate') || null,
    p_player_a: field(formData, 'playerA') || null,
    p_player_b: field(formData, 'playerB') || null,
    p_interaction_type: field(formData, 'interactionType') || null,
    p_description: field(formData, 'description') || null,
    p_task_id: taskId ? String(taskId) : null,
    p_screenshot_urls: urls,
  }
}

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export async function POST(request) {
  try {
    const data = await request.json()
    
    // Resolve user's Desktop directory
    const homeDir = os.homedir()
    const backupDir = path.join(homeDir, 'Desktop', 'Finanzas_Backups')
    
    // Ensure directory exists on the Desktop
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }
    
    // Create filename based on current date (backup_YYYY-MM-DD.json)
    const dateStr = new Date().toISOString().split('T')[0]
    const filePath = path.join(backupDir, `backup_${dateStr}.json`)
    
    // Write data to the backup file (overwrites if run multiple times in the same day)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    
    return NextResponse.json({ success: true, path: filePath })
  } catch (error) {
    console.error('Backup API error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

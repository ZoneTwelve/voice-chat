import { NextRequest, NextResponse } from 'next/server'

// Environment variables with fallback defaults
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.minimax.chat'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''

export async function GET(request: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY environment variable is not set' },
        { status: 500 }
      )
    }

    console.log('[API] Fetching models from:', `${OPENAI_BASE_URL}/v1/models`)

    const response = await fetch(`${OPENAI_BASE_URL}/v1/models`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[API] Models API error:', response.status, errorText)
      return NextResponse.json(
        { error: `Failed to fetch models: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('[API] Models fetched successfully:', data.data?.length || 0, 'models')

    return NextResponse.json(data)

  } catch (error) {
    console.error('[API] Models route error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// Handle preflight requests
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  })
}

import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { decodePaaFromPath } from '../api/launchpad'

export type P3dPreviewProps = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** Two floats per vertex when the preview pipeline supplied UVs. */
  uvs?: Float32Array | null
  /** Folder that contains the ``.p3d`` file; used to resolve companion ``.paa`` files. */
  modelDirectory?: string | null
  /** Texture names from model faces, most common first. */
  textureNames?: string[] | null
  className?: string
}

function boundsFromPositions(positions: Float32Array): { center: THREE.Vector3; size: number } {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]!)
    min.y = Math.min(min.y, positions[i + 1]!)
    min.z = Math.min(min.z, positions[i + 2]!)
    max.x = Math.max(max.x, positions[i]!)
    max.y = Math.max(max.y, positions[i + 1]!)
    max.z = Math.max(max.z, positions[i + 2]!)
  }
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5)
  const size = max.distanceTo(min) || 1
  return { center, size }
}

function joinDirFile(dir: string, rel: string): string {
  const base = dir.replace(/[/\\]+$/, '')
  const tail = rel
    .trim()
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
  const parts = tail.split('/').filter(Boolean)
  const win = base.includes('\\')
  return win ? [base, ...parts].join('\\') : [base, ...parts].join('/')
}

function textureTryPaths(modelDir: string, textureRef: string): string[] {
  const t = textureRef.trim()
  if (!t) return []
  const normalized = t.replace(/^[/\\]+/, '')
  const primary = joinDirFile(modelDir, normalized)
  const segments = normalized.split(/[/\\]+/).filter(Boolean)
  const basenameOnly = segments.length ? segments[segments.length - 1]! : normalized
  const secondary = joinDirFile(modelDir, basenameOnly)
  const ordered = primary === secondary ? [primary] : [primary, secondary]
  const out: string[] = []
  for (const p of ordered) {
    const lower = p.toLowerCase()
    if (lower.endsWith('.paa')) out.push(p)
    else out.push(`${p}.paa`)
  }
  return [...new Set(out)]
}

type ViewOptions = {
  wireframe: boolean
  showGrid: boolean
  showAxes: boolean
  showPointLight: boolean
  showShadows: boolean
  doubleSided: boolean
  flatShading: boolean
  useFileNormals: boolean
  useTexture: boolean
  flipTextureV: boolean
  selectedTexture: string
}

function PreviewMesh({
  positions,
  normals,
  indices,
  uvs,
  diffuseMap,
  options,
}: {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  uvs: Float32Array | null
  diffuseMap: THREE.DataTexture | null
  options: ViewOptions
}) {
  const fileNormalsRef = useRef<Float32Array | null>(null)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions.slice(), 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals.slice(), 3))
    fileNormalsRef.current = new Float32Array(normals)
    g.setIndex(new THREE.Uint32BufferAttribute(indices.slice(), 1))
    if (uvs && uvs.length === (positions.length / 3) * 2) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.slice(), 2))
    }
    g.computeBoundingSphere()
    return g
  }, [positions, normals, indices, uvs])

  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

  useEffect(() => {
    const g = geometry
    const na = g.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (!na) return
    if (options.useFileNormals && fileNormalsRef.current) {
      na.array.set(fileNormalsRef.current)
      na.needsUpdate = true
    } else {
      g.computeVertexNormals()
    }
  }, [geometry, options.useFileNormals])

  const color = options.wireframe ? '#9ef7ae' : options.useTexture && diffuseMap ? '#ffffff' : '#b8c4d4'

  return (
    <mesh geometry={geometry} castShadow={options.showShadows} receiveShadow={options.showShadows}>
      <meshStandardMaterial
        color={color}
        map={options.useTexture ? diffuseMap : null}
        metalness={0.05}
        roughness={0.65}
        wireframe={options.wireframe}
        flatShading={options.flatShading}
        side={options.doubleSided ? THREE.DoubleSide : THREE.FrontSide}
        shadowSide={options.doubleSided ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  )
}

function SceneRig({
  center,
  size,
}: {
  center: THREE.Vector3
  size: number
}) {
  const { camera } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const dist = Math.max(size * 1.4, 0.5)
    cam.position.set(center.x + dist * 0.85, center.y + dist * 0.55, center.z + dist * 0.85)
    cam.near = Math.max(0.001, dist / 2000)
    cam.far = Math.max(500, dist * 50)
    cam.updateProjectionMatrix()
    cam.lookAt(center)
  }, [camera, center, size])
  return null
}

function SceneContent(
  props: Omit<P3dPreviewProps, 'className'> & {
    view: ViewOptions
    diffuseMap: THREE.DataTexture | null
  },
) {
  const { center, size } = useMemo(() => boundsFromPositions(props.positions), [props.positions])
  const floorY = center.y - size * 0.52

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 10, 6]}
        intensity={0.9}
        castShadow={props.view.showShadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-6, 4, -3]} intensity={0.25} />
      {props.view.showPointLight ? <pointLight position={[2.5, 3.5, 2.5]} intensity={0.55} distance={0} /> : null}
      <SceneRig center={center} size={size} />
      <PreviewMesh
        positions={props.positions}
        normals={props.normals}
        indices={props.indices}
        uvs={props.uvs ?? null}
        diffuseMap={props.diffuseMap}
        options={props.view}
      />
      {props.view.showGrid ? (
        <Grid
          position={[center.x, floorY, center.z]}
          args={[size * 6, size * 6]}
          cellSize={size / 10}
          sectionSize={size / 5}
          fadeDistance={size * 24}
          infiniteGrid
          cellColor="#3a3d44"
          sectionColor="#5c6370"
        />
      ) : null}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={center} />
      {props.view.showAxes ? (
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#c47474', '#6ebf8b', '#7b9ad4']} labelColor="#e8e8ec" />
        </GizmoHelper>
      ) : null}
    </>
  )
}

function useDiffuseFromPaa(
  enabled: boolean,
  modelDirectory: string | null | undefined,
  textureRef: string,
  flipV: boolean,
): THREE.DataTexture | null {
  const [tex, setTex] = useState<THREE.DataTexture | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!enabled || !modelDirectory?.trim() || !textureRef.trim()) {
      setTex((cur) => {
        if (cur) cur.dispose()
        return null
      })
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      for (const abs of textureTryPaths(modelDirectory.trim(), textureRef)) {
        const r = await decodePaaFromPath(abs)
        if (cancelled) return
        if (r.ok !== true) continue
        const next = new THREE.DataTexture(r.data, r.width, r.height, THREE.RGBAFormat)
        next.needsUpdate = true
        next.colorSpace = THREE.SRGBColorSpace
        next.wrapS = THREE.RepeatWrapping
        next.wrapT = THREE.RepeatWrapping
        next.flipY = flipV
        next.generateMipmaps = false
        next.minFilter = THREE.LinearFilter
        next.magFilter = THREE.LinearFilter
        if (cancelled) {
          next.dispose()
          return
        }
        setTex((cur) => {
          if (cur) cur.dispose()
          return next
        })
        return
      }
      if (!cancelled) {
        setTex((cur) => {
          if (cur) cur.dispose()
          return null
        })
      }
    })()

    return () => {
      cancelled = true
      setTex((cur) => {
        if (cur) cur.dispose()
        return null
      })
    }
  }, [enabled, modelDirectory, textureRef, flipV])

  return tex
}

const defaultView = (): ViewOptions => ({
  wireframe: false,
  showGrid: true,
  showAxes: true,
  showPointLight: false,
  showShadows: false,
  doubleSided: false,
  flatShading: true,
  useFileNormals: true,
  useTexture: true,
  flipTextureV: false,
  selectedTexture: '',
})

/**
 * Interactive preview for decoded ``.p3d`` mesh data (desktop shell).
 */
export function P3dPreview({
  positions,
  normals,
  indices,
  uvs = null,
  modelDirectory = null,
  textureNames = null,
  className,
}: P3dPreviewProps) {
  const names = textureNames?.length ? textureNames : []
  const [view, setView] = useState<ViewOptions>(() => defaultView())

  const setTexturePick = useCallback((selectedTexture: string) => {
    setView((v) => ({ ...v, selectedTexture }))
  }, [])

  useEffect(() => {
    const first = names[0] ?? ''
    setView((v) => ({ ...v, selectedTexture: first }))
  }, [names])

  const activeName = view.selectedTexture || names[0] || ''
  const canSampleTexture = Boolean(uvs && uvs.length === (positions.length / 3) * 2 && modelDirectory?.trim() && activeName)
  const diffuseMap = useDiffuseFromPaa(
    view.useTexture && canSampleTexture,
    modelDirectory,
    activeName,
    view.flipTextureV,
  )

  return (
    <div className={['mission-image-preview', 'mission-p3d-preview', className].filter(Boolean).join(' ')}>
      <div className="mission-p3d-preview-toolbar" role="toolbar" aria-label="Model preview options">
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.wireframe}
            onChange={(e) => setView((v) => ({ ...v, wireframe: e.target.checked }))}
          />
          Wireframe
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.showGrid}
            onChange={(e) => setView((v) => ({ ...v, showGrid: e.target.checked }))}
          />
          Floor grid
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.showAxes}
            onChange={(e) => setView((v) => ({ ...v, showAxes: e.target.checked }))}
          />
          Orientation
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.showPointLight}
            onChange={(e) => setView((v) => ({ ...v, showPointLight: e.target.checked }))}
          />
          Point light
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.showShadows}
            onChange={(e) => setView((v) => ({ ...v, showShadows: e.target.checked }))}
          />
          Shadows
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.doubleSided}
            onChange={(e) => setView((v) => ({ ...v, doubleSided: e.target.checked }))}
          />
          Both sides
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.flatShading}
            onChange={(e) => setView((v) => ({ ...v, flatShading: e.target.checked }))}
          />
          Flat faces
        </label>
        <label className="mission-p3d-preview-opt">
          <input
            type="checkbox"
            checked={view.useFileNormals}
            onChange={(e) => setView((v) => ({ ...v, useFileNormals: e.target.checked }))}
          />
          Use model shading
        </label>
        {canSampleTexture || names.length ? (
          <label className="mission-p3d-preview-opt">
            <input
              type="checkbox"
              checked={view.useTexture}
              disabled={!canSampleTexture}
              onChange={(e) => setView((v) => ({ ...v, useTexture: e.target.checked }))}
            />
            Surface texture
          </label>
        ) : null}
        {canSampleTexture ? (
          <label className="mission-p3d-preview-opt">
            <input
              type="checkbox"
              checked={view.flipTextureV}
              onChange={(e) => setView((v) => ({ ...v, flipTextureV: e.target.checked }))}
            />
            Flip texture vertically
          </label>
        ) : null}
        {names.length > 1 ? (
          <label className="mission-p3d-preview-opt mission-p3d-preview-opt--grow">
            <span className="mission-p3d-preview-opt-label">Texture</span>
            <select
              className="mission-p3d-preview-select"
              value={activeName}
              onChange={(e) => setTexturePick(e.target.value)}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n.replace(/^[/\\]+/, '')}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="mission-image-preview-frame mission-p3d-preview-frame">
        <div className="mission-p3d-preview-canvas-wrap">
          <Canvas
            gl={{ antialias: true, alpha: true }}
            shadows={view.showShadows}
            onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
            camera={{ fov: 45, near: 0.05, far: 5000 }}
            style={{ width: '100%', height: '100%', minHeight: 280 }}
          >
            <Suspense fallback={null}>
              <SceneContent
                positions={positions}
                normals={normals}
                indices={indices}
                uvs={uvs}
                modelDirectory={modelDirectory}
                textureNames={textureNames}
                view={view}
                diffuseMap={diffuseMap}
              />
            </Suspense>
          </Canvas>
        </div>
      </div>
    </div>
  )
}

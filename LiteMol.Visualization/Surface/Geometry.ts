﻿/*
 * Copyright (c) 2016 David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */

namespace LiteMol.Visualization.Surface {
    "use strict";
    
    import Data = Core.Geometry.Surface;
    
    interface Context {
        data: Data,
        computation: Core.Computation.Context<Model>,
        geom: Geometry,
        
        vertexCount: number,
        triCount: number,
        
        pickColorBuffer?: Float32Array;
        pickTris?: Core.Utils.ChunkedArrayBuilder<number>;
        pickPlatesVertices?: Core.Utils.ChunkedArrayBuilder<number>;
        pickPlatesTris?: Core.Utils.ChunkedArrayBuilder<number>;
        pickPlatesColors?: Core.Utils.ChunkedArrayBuilder<number>;
        platesVertexCount?: number;
    }
     
    function sortAnnotation(ctx: Context) {
        let indices = new Int32Array(ctx.data.annotation.length);
        let annotation = ctx.data.annotation;
        for (let i = 0, _b = indices.length; i < _b; i++) indices[i] = i;
        Array.prototype.sort.call(indices, function (a: number, b: number) {
            let ret = annotation[a] - annotation[b];
            if (!ret) return a - b;
            return ret;
        });
        return indices;
    }
    
    let cntr = 0;
    function splice(start: number, end: number, indices: Int32Array, map: Selection.VertexMapBuilder) {
        let currentStart = start;
        let currentEnd = start + 1;
        
        while (currentStart < end) {
            while (currentEnd <= end && indices[currentEnd] - indices[currentEnd - 1] < 1.1) currentEnd++;
            map.addVertexRange(indices[currentStart], indices[currentEnd - 1] + 1);       
            currentStart = currentEnd;
            currentEnd = currentEnd + 1;
        }        
    }
    
    function createVertexMap(ctx: Context) {
        let indices = sortAnnotation(ctx);
        let annotation = ctx.data.annotation;
        let count = 0;
        for (let i = 0, _b = indices.length - 1; i < _b; i++) {
            if (annotation[indices[i]] !== annotation[indices[i + 1]]) count++;
        }        
        let map = new Selection.VertexMapBuilder(count);
        
        let xs = new Int32Array(indices.length);
        for (let i = 0, _b = indices.length; i < _b; i++) {
            xs[i] = annotation[indices[i]];
        }
        let currentAnnotation = annotation[indices[0]];
        map.startElement(currentAnnotation);
        for (let i = 0, _b = indices.length; i < _b; i++) {
            let an = annotation[indices[i]];
            if (an !== currentAnnotation) {
                map.endElement();
                map.startElement(an);
                currentAnnotation = an;
            }
            
            let start = i;
            i++;
            while (an === annotation[indices[i]]) i++;
            let end = i;
            i--;
            splice(start, end, indices, map);    
        }
        map.endElement();
        return map.getMap();        
    }
    
    function createFullMap(ctx: Context) {
        let map = new Selection.VertexMapBuilder(1);
        map.startElement(0);
        map.addVertexRange(0, ctx.vertexCount);
        map.endElement();
        return map.getMap();
    }
    
    function computeVertexMap(ctx: Context, next: () => void) {
        ctx.computation.update('Computing selection map...');
        
        ctx.computation.schedule(() => {
            if (ctx.data.annotation) {
                ctx.geom.elementToVertexMap = createVertexMap(ctx);
            } else {
                ctx.geom.elementToVertexMap = createFullMap(ctx);
            }            
            next();
        }, 1000 / 15);
    }
     
    function computePickPlatesChunk(start: number, ctx: Context, next: () => void) {
        let chunkSize = 100000;
        
        let tri = ctx.data.triangleIndices;
        let ids = ctx.data.annotation;
        
        if (start >= ctx.triCount) {
            next();
            return;
        }
        
        let pickPlatesVertices = ctx.pickPlatesVertices;
        let pickPlatesTris = ctx.pickPlatesTris;
        let pickPlatesColors = ctx.pickPlatesColors;
        let vs = ctx.data.vertices;
        let color = { r: 0.45, g: 0.45, b: 0.45 };
        let pickTris = ctx.pickTris;
        
        ctx.computation.update('Creating selection geometry...', ctx.computation.abortRequest, start, ctx.triCount);
        if (ctx.computation.abortRequested) {
            ctx.computation.abort();
            return;
        }
        
        let platesVertexCount = 0;
        for (let i = start, _b = Math.min(start + chunkSize, ctx.triCount); i < _b; i++) {
            let a = tri[3 * i], b = tri[3 * i + 1], c = tri[3 * i + 2];
            let aI = ids[a], bI = ids[b], cI = ids[c];
            
            if (aI === bI && bI === cI) {
                pickTris.add3(a, b, c);
                continue;
            }
            
            let s = aI === bI ? aI : bI;

            pickPlatesVertices.add3(vs[3 * a], vs[3 * a + 1], vs[3 * a + 2]);
            pickPlatesVertices.add3(vs[3 * b], vs[3 * b + 1], vs[3 * b + 2]);
            pickPlatesVertices.add3(vs[3 * c], vs[3 * c + 1], vs[3 * c + 2]);

            pickPlatesTris.add3(platesVertexCount++, platesVertexCount++, platesVertexCount++);

            if (s < 0) {
                color.r = 0; color.g = 0; color.b = 0;
            } else {
                Selection.Picking.assignPickColor(s, color);
            }

            pickPlatesColors.add4(color.r, color.g, color.b, 0.0);
            pickPlatesColors.add4(color.r, color.g, color.b, 0.0);
            pickPlatesColors.add4(color.r, color.g, color.b, 0.0);
        }
        ctx.platesVertexCount += platesVertexCount;
        
        ctx.computation.schedule(() => computePickPlatesChunk(start + chunkSize, ctx, next));
    }
    
    function assignPickColors(ctx: Context) {
        let color = { r: 0.45, g: 0.45, b: 0.45 },
            vs = ctx.data.vertices,
            ids = ctx.data.annotation,
            tri = ctx.data.triangleIndices;
        
        
        ctx.pickTris = Core.Utils.ChunkedArrayBuilder.forIndexBuffer(ctx.triCount);            
        let pickColorBuffer = ctx.pickColorBuffer;
            
        for (let i = 0, _b = ctx.vertexCount; i < _b; i++) {
            let id = ids[i];
            if (id >= 0) {                    
                Selection.Picking.assignPickColor(id, color);
                pickColorBuffer[i * 4] = color.r;
                pickColorBuffer[i * 4 + 1] = color.g;
                pickColorBuffer[i * 4 + 2] = color.b;
            }
        }
    }
    
    function createFullPickGeometry(ctx: Context) {
        let pickGeometry = new THREE.BufferGeometry();
        pickGeometry.addAttribute('position', new THREE.BufferAttribute(ctx.data.vertices, 3));
        pickGeometry.addAttribute('index', new THREE.BufferAttribute(ctx.data.triangleIndices, 1));
        pickGeometry.addAttribute('pColor', new THREE.BufferAttribute(ctx.pickColorBuffer, 4));
        ctx.geom.pickGeometry = pickGeometry;

        pickGeometry = new THREE.BufferGeometry();
        pickGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
        pickGeometry.addAttribute('index', new THREE.BufferAttribute(new Uint32Array(0), 1));
        pickGeometry.addAttribute('pColor', new THREE.BufferAttribute(new Float32Array(0), 4));
        ctx.geom.pickPlatesGeometry = pickGeometry;
    }
    
     function createPickGeometry(ctx: Context) {
        let pickGeometry = new THREE.BufferGeometry();
        pickGeometry.addAttribute('position', new THREE.BufferAttribute(ctx.data.vertices, 3));
        pickGeometry.addAttribute('index', new THREE.BufferAttribute(ctx.pickTris.compact(), 1));
        pickGeometry.addAttribute('pColor', new THREE.BufferAttribute(ctx.pickColorBuffer, 4));
        ctx.geom.pickGeometry = pickGeometry;

        pickGeometry = new THREE.BufferGeometry();
        pickGeometry.addAttribute('position', new THREE.BufferAttribute(ctx.pickPlatesVertices.compact(), 3));
        pickGeometry.addAttribute('index', new THREE.BufferAttribute(ctx.pickPlatesTris.compact(), 1));
        pickGeometry.addAttribute('pColor', new THREE.BufferAttribute(ctx.pickPlatesColors.compact(), 4));
        ctx.geom.pickPlatesGeometry = pickGeometry;
    }
    
    function addWireframeEdge(edges: Core.Utils.ChunkedArrayBuilder<number>, included: Set<number>, a: number, b: number) {
        if (a > b) {
            let t = a;
            a = b;
            b = t;
        }
        
        let cantorPairing = (((a + b) * (a + b + 1) + b) / 2) | 0;
        let oldSize = included.size;
        included.add(cantorPairing);
        if (included.size === oldSize) return;
        edges.add2(a, b);
    }

    function buildWireframeIndices(ctx: Context) {
        let tris = ctx.data.triangleIndices;
        let edges = new Core.Utils.ChunkedArrayBuilder<number>(size => new Uint32Array(size), (1.5 * ctx.triCount) | 0, 2);
        let includedEdges = new Set<number>();

        for (let i = 0, _b = tris.length; i < _b; i += 3) {            
            let a = tris[i], b = tris[i + 1], c = tris[i + 2];
            addWireframeEdge(edges, includedEdges, a, b);
            addWireframeEdge(edges, includedEdges, a, c);
            addWireframeEdge(edges, includedEdges, b, c);
        }
        return new THREE.BufferAttribute(edges.compact(), 1);
    } 

    function createGeometry(isWireframe: boolean, ctx: Context) {
        let geometry = new THREE.BufferGeometry();
        geometry.addAttribute('position', new THREE.BufferAttribute(ctx.data.vertices, 3));
        geometry.addAttribute('normal', new THREE.BufferAttribute(ctx.data.normals, 3));
        geometry.addAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * ctx.data.vertices.length), 3));

        if (isWireframe) {
            geometry.addAttribute('index', buildWireframeIndices(ctx));
        } else {
            geometry.addAttribute('index', new THREE.BufferAttribute(ctx.data.triangleIndices, 1));
        }

        ctx.geom.geometry = geometry;
        ctx.geom.vertexStateBuffer = new THREE.BufferAttribute(new Float32Array(ctx.data.vertices.length), 1);
        geometry.addAttribute('vState', ctx.geom.vertexStateBuffer);
    }
    
    function computePickGeometry(ctx: Context, next: () => void) {
        
        ctx.computation.update('Creating selection geometry...');
        
        ctx.computation.schedule(() => {            
            ctx.pickColorBuffer = new Float32Array(ctx.vertexCount * 4);            
            if (!ctx.data.annotation) {
                createFullPickGeometry(ctx);
                next();
            } else {
                
                assignPickColors(ctx);
                ctx.pickPlatesVertices = Core.Utils.ChunkedArrayBuilder.forVertex3D(Math.max(ctx.vertexCount / 10, 10));
                ctx.pickPlatesTris = Core.Utils.ChunkedArrayBuilder.forIndexBuffer(Math.max(ctx.triCount / 10, 10));
                ctx.pickPlatesColors = new Core.Utils.ChunkedArrayBuilder<number>(s => new Float32Array(s), Math.max(ctx.vertexCount / 10, 10), 4);
                ctx.platesVertexCount = 0;
                
                computePickPlatesChunk(0, ctx, () => {
                    createPickGeometry(ctx);
                    next();
                });
            }                        
        });
    }
         
    export function buildGeometry(data: Data, computation: Core.Computation.Context<Model>, isWireframe: boolean, done: (g: Geometry) => void) {
        
        let ctx: Context = {
            data,
            computation,
            geom: new Geometry(),
            vertexCount: (data.vertices.length / 3) | 0,
            triCount: (data.triangleIndices.length / 3) | 0 
        };
        
        computation.update('Creating geometry...');
        let surface = Core.Geometry.Surface.computeNormals(data)
            .bind(s => {
                return Core.Geometry.Surface.computeBoundingSphere(s)
            }).run(<any>computation)
        
        // surface.progress.subscribe(p => computaion);    
        //  surface.progress.
            .result.then(() => {    
                computation.schedule(() => {computeVertexMap(ctx, () => {
                        computePickGeometry(ctx, () => {
                            createGeometry(isWireframe, ctx);
                            ctx.geom.vertexToElementMap = ctx.data.annotation;
                            done(ctx.geom);
                        })
                    })
                });
            })
           .catch(computation.reject);
    }
        
    export class Geometry extends GeometryBase {

        geometry: THREE.BufferGeometry = void 0; 
        vertexToElementMap: number[] = void 0; 
        elementToVertexMap: Selection.VertexMap = void 0; 
                
        pickGeometry: THREE.BufferGeometry = void 0; 
        pickPlatesGeometry: THREE.BufferGeometry = void 0; 

        vertexStateBuffer: THREE.BufferAttribute = void 0; 

        center: THREE.Vector3 = void 0; 
        radius: number = void 0; 
        
        dispose() {
            this.geometry.dispose();
            if (this.pickGeometry) {
                this.pickGeometry.dispose();
                this.pickPlatesGeometry.dispose();
            }
        }
        
        constructor() {
            super();
        }
    }
}
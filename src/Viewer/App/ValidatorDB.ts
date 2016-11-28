/*
 * Copyright (c) 2016 David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */

namespace LiteMol.Viewer.ValidatorDB {
    import Entity = Bootstrap.Entity;
    import Transformer = Bootstrap.Entity.Transformer;
            
    export interface ReportProps extends Entity.Behaviour.Props<Interactivity.Behaviour> {}
    export interface Report extends Entity<Report, ReportType, ReportProps> { }         
    export interface ReportType extends Entity.Type<ReportType, Report, ReportProps> { }   
    export const Report = Entity.create<Report, ReportType, ReportProps>({ name: 'ValidatorDB Validation Report', typeClass: 'Behaviour', shortName: 'VR', description: 'Represents ValidatorDB validation report.' });
    
    namespace Api {     

        export type Report = {
            get(authAsymId: string): undefined | {
                get(authSeqNumber: number): undefined | {
                    flags: string[],
                    isRed: boolean,
                    chiralityMismatches: { has(atomId: number): boolean }
                } 
            }
        };

        function getResidueId(id: string, out: { authSeqNumber: number, authAsymId: string }) {
            let fields = id.split(' ');
            out.authSeqNumber = +fields[1];
            out.authAsymId = fields[2];
        }

        function getAtomId(id: string) {
            return +id.split(' ')[2];
        }

        const RedFlags = new Set<string>(['Missing', 'NotAnalyzed']);

        function isRed(flags: string[]) {
            for (let f of flags) if (RedFlags.has(f)) return true;
            return false;
        }
        
        export function createReport(data: any): Report {
            let report: any = new Map<string, any>();
            if (!data.Models) return report;

            let residue = { authSeqNumber: 0, authAsymId: '' };
            let emptySet = new Set<number>();
            for (let model of data.Models) {
                for (let entry of model.Entries) {
                    if (!entry.MainResidue) continue;

                    getResidueId(entry.MainResidue, residue);

                    let residueReport = report.get(residue.authAsymId) as Map<number, any>;
                    if (residueReport === void 0) {
                        residueReport = new Map<number, any>();
                        report.set(residue.authAsymId, residueReport);
                    }

                    let flags: string[] = [];
                    if (entry.Flags.indexOf('Missing_Atoms') >= 0) flags.push('Missing Atoms');
                    if (entry.Flags.indexOf('Missing_Rings') >= 0) flags.push('Missing Rings');
                    if (entry.Flags.indexOf('Missing_Degenerate') >= 0) flags.push('Degenerate');
                    if (entry.Flags.indexOf('HasAll_BadChirality') >= 0) flags.push('Bad Chirality');

                    if (!flags.length) flags.push('No Issue');

                    let chiralityMismatchSet: Set<number> | undefined = void 0;
                    let chiralityMismatches = entry.ChiralityMismatches;
                    for (let _m of Object.keys(chiralityMismatches)) {
                        if (!Object.prototype.hasOwnProperty.call(chiralityMismatches, _m)) continue;
                        let a = chiralityMismatches[_m];
                        if (!chiralityMismatchSet) chiralityMismatchSet = new Set<number>();
                        chiralityMismatchSet.add(getAtomId(a));
                    }

                    residueReport.set(residue.authSeqNumber, {
                        isRed: isRed(entry.Flags),
                        flags,
                        chiralityMismatches: chiralityMismatchSet ? chiralityMismatchSet : emptySet
                    });
                }
            }

            return report;
        }
    }
    
    namespace Interactivity {
        
        export class Behaviour implements Bootstrap.Behaviour.Dynamic {
            private provider: Bootstrap.Interactivity.HighlightProvider;
            
            dispose() {
                this.context.highlight.removeProvider(this.provider);
            }
                    
            register(behaviour: any) {
                 this.context.highlight.addProvider(this.provider);
            }
            
            private processInfo(info: Bootstrap.Interactivity.Info): string | undefined {
                let i = Bootstrap.Interactivity.Molecule.transformInteraction(info);
                
                if (!i || i.residues.length > 1) return void 0;                    
                
                let r = this.report;
                if (i.atoms.length === 1) {
                    let a = i.atoms[0];
                    let chain = r.get(a.residue.chain.authAsymId);
                    let residue = chain ? chain.get(a.residue.authSeqNumber) : void 0;
                    let badChirality = residue ? residue.chiralityMismatches.has(a.id) : false;
                    if (!residue) return void 0;

                    return `<div><small>[ValidatorDB]</small> Atom: <b>${badChirality ? 'Bad Chirality' : 'OK'}</b>, Residue: <b>${residue.flags.join(', ')}</b></div>`;
                } else {
                    let res = i.residues[0];
                    let chain = r.get(res.chain.authAsymId);
                    let residue = chain ? chain.get(res.authSeqNumber) : void 0;
                    if (!residue) return void 0;

                    return `<div><small>[ValidatorDB]</small> Residue: <b>${residue.flags.join(', ')}</b></div>`;
                }
            }
            
            constructor(public context: Bootstrap.Context, public report: Api.Report) {                
                this.provider = info => {                    
                    try {
                        return this.processInfo(info);
                    } catch (e) {
                        console.error('Error showing validation label', e);   
                        return void 0;
                    }
                };                
            }   
        }
        
    }
    
    namespace Theme {    
        const colorMap = (function () {
            let colors = new Map<number, LiteMol.Visualization.Color>();
            colors.set(0, { r: 0.4, g: 0.4, b: 0.4 }); 
            colors.set(1, { r: 0, g: 1, b: 0 }); 
            colors.set(2, { r: 1, g: 0, b: 0 });
            return colors;
        })();
        
        const defaultColor = <LiteMol.Visualization.Color>{ r: 0.6, g: 0.6, b: 0.6 };
        const selectionColor = <LiteMol.Visualization.Color>{ r: 0, g: 0, b: 1 };
        const highlightColor = <LiteMol.Visualization.Color>{ r: 1, g: 0, b: 1 };
    
        function createAtomMapNormal(model: LiteMol.Core.Structure.MoleculeModel, report: Api.Report) {
            let map = new Uint8Array(model.atoms.count);            
            let mId = model.modelId;
            let { authAsymId, authSeqNumber, atomStartIndex, atomEndIndex } = model.residues;
            let { id } = model.atoms;

            for (let rI = 0, _rI = model.residues.count; rI < _rI; rI++) {
                let repC = report.get(authAsymId[rI]);
                if (!repC) continue;
                let repR = repC.get(authSeqNumber[rI]);
                if (!repR) continue;

                let chiralityMismatches = repR.chiralityMismatches;
                for (let aI = atomStartIndex[rI], _aI = atomEndIndex[rI]; aI < _aI; aI++) {
                    if (repR.isRed) map[aI] = 2;
                    else if (chiralityMismatches.has(id[aI])) map[aI] = 2;
                    else map[aI] = 1;
                }
            }

            return map;            
        }
        
        function createAtomMapComputed(model: LiteMol.Core.Structure.MoleculeModel, report: any) {
            let parent = model.parent!;
            let map = new Uint8Array(model.atoms.count);            
            let mId = model.modelId;
            let { authAsymId, authSeqNumber, atomStartIndex, atomEndIndex, chainIndex } = model.residues;
            let { sourceChainIndex } = model.chains;
            let { id } = model.atoms;

            for (let rI = 0, _rI = model.residues.count; rI < _rI; rI++) {
                let repC = report.get(authAsymId[sourceChainIndex![chainIndex[rI]]]);
                if (!repC) continue;
                let repR = repC.get(authSeqNumber[rI]);
                if (!repR) continue;

                let chiralityMismatches = repR.chiralityMismatches;
                for (let aI = atomStartIndex[rI], _aI = atomEndIndex[rI]; aI < _aI; aI++) {
                    if (repR.isRed) map[aI] = 2;
                    else if (!chiralityMismatches.has(id[aI])) map[aI] = 2;
                    else map[aI] = 1;
                }
            }
                    
            return map;                
        }
    
        export function create(entity: Bootstrap.Entity.Molecule.Model, report: any) {
            let model = entity.props.model;
            let map = model.source === Core.Structure.MoleculeModelSource.File 
                ? createAtomMapNormal(model, report)
                : createAtomMapComputed(model, report);
            
            let colors = new Map<string, LiteMol.Visualization.Color>();
            colors.set('Uniform', defaultColor)
            colors.set('Selection', selectionColor)
            colors.set('Highlight', highlightColor);
            let residueIndex = model.atoms.residueIndex;            
            
            let mapping = Visualization.Theme.createColorMapMapping(i => map[i], colorMap, defaultColor);
            return Visualization.Theme.createMapping(mapping, { colors, interactive: true, transparency: { alpha: 1.0 } });
        }                
    }
    
    const Create = Bootstrap.Tree.Transformer.create<Entity.Data.String, Report, { id?: string }>({
            id: 'validatordb-create',
            name: 'ValidatorDB Validation',
            description: 'Create the validation report from a string.',
            from: [Entity.Data.String],
            to: [Report],
            defaultParams: () => ({})
        }, (context, a, t) => { 
            return Bootstrap.Task.create<Report>(`ValidatorDB Report (${t.params.id})`, 'Normal', ctx => {
                ctx.update('Parsing...');
                ctx.schedule(() => {
                    let data = JSON.parse(a.props.data);
                    let report = Api.createReport(data || {});                    
                    ctx.resolve(Report.create(t, { label: 'ValidatorDB Report', behaviour: new Interactivity.Behaviour(context, report) }))
                });
            }).setReportTime(true);
        }       
    );
        
    export const DownloadAndCreate = Bootstrap.Tree.Transformer.action<Entity.Molecule.Molecule, Entity.Action, { }>({
        id: 'validatordb-download-and-create',
        name: 'ValidatorDB Validation Report',
        description: 'Download Validation Report from ValidatorDB',
        from: [Entity.Molecule.Molecule],
        to: [Entity.Action],
        defaultParams: () => ({})
    }, (context, a, t) => {        
        let id = a.props.molecule.id.trim().toLocaleLowerCase();                    
        let action = Bootstrap.Tree.Transform.build()
            .add(a, Transformer.Data.Download, { url: `https://webchem.ncbr.muni.cz/Platform/ValidatorDb/Data/${id}?source=ByStructure`, type: 'String', id, description: 'Validation Data' })
            .then(Create, { id }, { isBinding: true });

        return action;
    }, "Validation report loaded. Hovering over residue will now contain validation info. To apply validation coloring, select the 'ValidatorDB Report' entity in the tree and apply it the right panel. " +
        "Only missing atoms/rings and chirality issues are shown, for more details please visit https://webchem.ncbr.muni.cz/Platform/ValidatorDb/Index.");
    
    export const ApplyTheme = Bootstrap.Tree.Transformer.create<Report, Entity.Action, { }>({
        id: 'validatordb-apply-theme',
        name: 'Apply Coloring',
        description: 'Colors all visuals using the validation report.',
        from: [Report],
        to: [Entity.Action],
        defaultParams: () => ({})  
    }, (context, a, t) => {        
            return Bootstrap.Task.create<Entity.Action>('Validation Coloring', 'Background', ctx => {            
            let molecule = Bootstrap.Tree.Node.findAncestor(a, Bootstrap.Entity.Molecule.Molecule);
            if (!molecule)  {
                ctx.reject('No suitable parent found.');
                return;
            } 
                
            let themes = new Map<number, Visualization.Theme>();      
            let visuals = context.select(Bootstrap.Tree.Selection.byValue(molecule).subtree().ofType(Bootstrap.Entity.Molecule.Visual));            
            for (let v of visuals) {
                let model = Bootstrap.Utils.Molecule.findModel(v);
                if (!model) continue;                
                let theme = themes.get(model.id);                
                if (!theme) {
                    theme = Theme.create(model, a.props.behaviour.report);
                    themes.set(model.id, theme);
                }                
                Bootstrap.Command.Visual.UpdateBasicTheme.dispatch(context, { visual: v as any, theme });
            }                                   
            context.logger.message('Validation coloring applied.');
            ctx.resolve(Bootstrap.Tree.Node.Null);
        });
    });
}
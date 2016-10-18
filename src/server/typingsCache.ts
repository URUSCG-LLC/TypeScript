/// <reference path="project.ts"/>

namespace ts.server {

    export interface ITypingsInstaller {
        enqueueInstallTypingsRequest(p: Project, typingOptions: TypingOptions, unresolvedImports: UnresolvedImports): void;
        attach(projectService: ProjectService): void;
        onProjectClosed(p: Project): void;
        readonly globalTypingsCacheLocation: string;
    }

    export const nullTypingsInstaller: ITypingsInstaller = {
        enqueueInstallTypingsRequest: () => {},
        attach: (projectService: ProjectService) => {},
        onProjectClosed: (p: Project) => {},
        globalTypingsCacheLocation: undefined
    };

    class TypingsCacheEntry {
        readonly typingOptions: TypingOptions;
        readonly compilerOptions: CompilerOptions;
        readonly typings: TypingsArray;
        readonly unresolvedImportsVersion: number;
        poisoned: boolean;
    }

    function setIsEqualTo(arr1: string[], arr2: string[]): boolean {
        if (arr1 === arr2) {
            return true;
        }
        if ((arr1 || emptyArray).length === 0 && (arr2 || emptyArray).length === 0) {
            return true;
        }
        const set: Map<boolean> = createMap<boolean>();
        let unique = 0;

        for (const v of arr1) {
            if (set[v] !== true) {
                set[v] = true;
                unique++;
            }
        }
        for (const v of arr2) {
            if (!hasProperty(set, v)) {
                return false;
            }
            if (set[v] === true) {
                set[v] = false;
                unique--;
            }
        }
        return unique === 0;
    }

    function typingOptionsChanged(opt1: TypingOptions, opt2: TypingOptions): boolean {
        return opt1.enableAutoDiscovery !== opt2.enableAutoDiscovery ||
            !setIsEqualTo(opt1.include, opt2.include) ||
            !setIsEqualTo(opt1.exclude, opt2.exclude);
    }

    function compilerOptionsChanged(opt1: CompilerOptions, opt2: CompilerOptions): boolean {
        // TODO: add more relevant properties
        return opt1.allowJs != opt2.allowJs;
    }

    export interface TypingsArray extends ReadonlyArray<string> {
        " __typingsArrayBrand": any;
    }

    function toTypingsArray(arr: string[]): TypingsArray {
        arr.sort();
        return <any>arr;
    }

    export class TypingsCache {
        private readonly perProjectCache: Map<TypingsCacheEntry> = createMap<TypingsCacheEntry>();

        constructor(private readonly installer: ITypingsInstaller) {
        }

        getTypingsForProject(project: Project, forceRefresh: boolean): TypingsArray {
            const typingOptions = project.getTypingOptions();

            if (!typingOptions || !typingOptions.enableAutoDiscovery) {
                return <any>emptyArray;
            }

            const entry = this.perProjectCache[project.getProjectName()];
            const result: TypingsArray = entry ? entry.typings : <any>emptyArray;
            const unresolvedImports = project.getUnresolvedImpors();
            if (forceRefresh ||
                !entry ||
                entry.unresolvedImportsVersion !== unresolvedImports.version ||
                typingOptionsChanged(typingOptions, entry.typingOptions) ||
                compilerOptionsChanged(project.getCompilerOptions(), entry.compilerOptions)) {
                // Note: entry is now poisoned since it does not really contain typings for a given combination of compiler options\typings options.
                // instead it acts as a placeholder to prevent issuing multiple requests
                this.perProjectCache[project.getProjectName()] = {
                    compilerOptions: project.getCompilerOptions(),
                    typingOptions,
                    typings: result,
                    unresolvedImportsVersion: unresolvedImports.version,
                    poisoned: true
                };
                // something has been changed, issue a request to update typings
                this.installer.enqueueInstallTypingsRequest(project, typingOptions, unresolvedImports);
            }
            return result;
        }

        invalidateCachedTypingsForProject(project: Project) {
            this.getTypingsForProject(project, /*forceRefresh*/ true);
        }

        updateTypingsForProject(projectName: string,
            compilerOptions: CompilerOptions,
            typingOptions: TypingOptions,
            unresolvedImportsVersion: number,
            newTypings: string[]) {
            this.perProjectCache[projectName] = {
                compilerOptions,
                typingOptions,
                typings: toTypingsArray(newTypings),
                unresolvedImportsVersion,
                poisoned: false
            };
        }

        onProjectClosed(project: Project) {
            delete this.perProjectCache[project.getProjectName()];
            this.installer.onProjectClosed(project);
        }
    }
}
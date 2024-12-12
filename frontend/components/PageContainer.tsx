// components/Layout.tsx
import { View, ViewProps } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import { globalStyles, colors } from '../styles/global';
import { SQLiteProvider } from "expo-sqlite";

type LayoutProps = {
    children: React.ReactNode;
    contentStyle?: ViewProps['style']; // Add a prop for the content container's style
} & ViewProps;

export function Layout({ children, style, contentStyle, ...props }: LayoutProps) {
    return (
        <View style={[globalStyles.container, style]} {...props}>
            <LinearGradient
                colors={colors.background}
                style={globalStyles.gradient}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.7, y: 1 }}
            >

                <View style={[globalStyles.contentContainer, contentStyle]}>
                    <SQLiteProvider databaseName='myDatabase.db' >  
                        {/* /* Allow useSqlLiteContext for any children basically*/}
                        {children}
                    </SQLiteProvider>
                </View>
                
            </LinearGradient>
        </View>
    );
}
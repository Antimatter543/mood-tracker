// components/Layout.tsx
import { View, ViewProps } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import { globalStyles, colors } from '../styles/global';

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

                    {children}

                </View>
                
            </LinearGradient>
        </View>
    );
}